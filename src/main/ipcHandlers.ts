import { app, BrowserWindow, dialog, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { IPC } from "../shared/ipc";
import { APP_NAME, APP_VERSION, GITHUB_REPO, LOG_FILE } from "../shared/constants";
import type {
  AgentEvent,
  Chat,
  IpcResult,
  McpServerConfig,
  PatchRequest,
  ProviderInput
} from "../shared/types";
import { ipcMain } from "electron";
import { friendlyError, logger } from "./services/logger";
import { settingsStore } from "./services/settingsStore";
import { chatStore } from "./services/chatStore";
import { workspaceService } from "./workspace/workspaceService";
import { terminalService } from "./terminal/terminalService";
import { providerManager } from "./providers/providers";
import { agentManager } from "./agent/agentManager";
import { mcpManager } from "./mcp/mcpManager";
import { scanImports } from "./fileSystem/importScanner";
import { snapshotManager } from "./fileSystem/snapshotManager";
import { vectorStore } from "./agent/vectorStore";
import { fileWatcher } from "./fileSystem/fileWatcher";
import { readFileChunked } from "./fileSystem/fileIO";
import { embeddingConfig } from "./tools/nativeTools";
import { resolveWorkspacePath, PathSecurityError } from "./workspace/pathSecurity";
import { persistentStore, sanitizeWindowBounds } from "./store/persistentStore";
import type { PersistKey, RecentModel, WindowBounds } from "../shared/types";
import { randomUUID } from "node:crypto";

function wrap<Args extends unknown[], T>(fn: (...args: Args) => Promise<T> | T): (...args: Args) => Promise<IpcResult<T>> {
  return async (...args: Args): Promise<IpcResult<T>> => {
    try {
      const data = await fn(...args);
      return { success: true, data };
    } catch (err) {
      const { message, technical } = friendlyError(err);
      if (!(err instanceof PathSecurityError)) {
        logger.error("ipc", technical);
      }
      return { success: false, error: message, details: technical };
    }
  };
}

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function emitAgentEvent(win: BrowserWindow | null, event: AgentEvent): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC.agentEvent, event);
}

function startBackgroundIndex(win: BrowserWindow | null, root: string): void {
  try {
    if (!settingsStore.get().vector.enabled) return;
    if (vectorStore.isIndexing(root)) return;
    void vectorStore
      .index(root, embeddingConfig(), (done, total, note) => {
        emitAgentEvent(win, { kind: "index", runId: "indexer", timestamp: Date.now(), done, total, text: note } as AgentEvent);
      })
      .then((status) => {
        emitAgentEvent(win, { kind: "index", runId: "indexer", timestamp: Date.now(), status: "complete", done: status.files, total: status.files } as AgentEvent);
        logger.info("vector", `indexed ${status.files} files / ${status.chunks} chunks (${status.backend})`);
      })
      .catch((err: unknown) => logger.warn("vector", `index failed: ${err instanceof Error ? err.message : String(err)}`));
  } catch (err) {
    logger.warn("vector", `index start failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function startTreeWatcher(root: string): void {
  fileWatcher.start(root, (rel, op) => {
    for (const win of BrowserWindow.getAllWindows()) {
      emitAgentEvent(win, { kind: "file_changed", runId: "external", timestamp: Date.now(), path: rel, operation: op, summary: `${op} on disk` });
    }
  });
  logger.info("watcher", `file watcher started for ${root}`);
}

const STREAM_LIMIT_BYTES = 8 * 1024 * 1024;
const MAX_ACTIVE_STREAMS = 4;
interface FileStreamEntry {
  win: BrowserWindow | null;
  controller: AbortController;
}
const fileStreams = new Map<string, FileStreamEntry>();

function abortAllFileStreams(): void {
  for (const [, st] of fileStreams) {
    st.controller.abort();
  }
  fileStreams.clear();
}

export function registerIpcHandlers(): void {
  mcpManager.setEventSink((kind, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      emitAgentEvent(win, {
        kind: "mcp_event",
        runId: "system",
        timestamp: Date.now(),
        status: kind,
        text: typeof payload.server === "string" ? String(payload.server) : undefined,
        ...payload
      } as AgentEvent);
    }
  });

  terminalService.setEventSink((chunk) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.terminalStream, chunk);
    }
  });

  ipcMain.handle(
    IPC.appInfo,
    wrap(() => {
      let user = "friend";
      try {
        user = os.userInfo().username || user;
      } catch {
        /* keep default */
      }
      return { version: APP_VERSION, name: APP_NAME, user };
    })
  );

  ipcMain.handle(
    IPC.appLatestRelease,
    wrap(async () => {
      try {
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
          headers: { "user-agent": "utcode-desktop", accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(9000)
        });
        if (!res.ok) return null;
        const json = (await res.json().catch(() => null)) as { tag_name?: string } | null;
        const tag = json?.tag_name ?? null;
        return tag ? tag.replace(/^v/i, "") : null;
      } catch {
        return null;
      }
    })
  );

  ipcMain.handle(
    IPC.workspaceChooseDirectory,
    wrap(async (event: Electron.IpcMainInvokeEvent) => {
      const win = senderWindow(event);
      if (!win) return null;
      const result = await dialog.showOpenDialog(win, {
        title: "Open workspace folder",
        properties: ["openDirectory", "createDirectory"]
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    })
  );

  ipcMain.handle(
    IPC.workspaceOpenPath,
    wrap((event: Electron.IpcMainInvokeEvent, root: string, remember?: boolean) => {
      if (typeof root !== "string" || root.trim().length === 0) throw new Error("Workspace path must be a non-empty string.");
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw new Error(`Not a valid directory: ${root}`);
      }
      const resolved = workspaceService.open(path.resolve(root), remember !== false);
      terminalService.registerWorkspaceCwd(resolved);
      snapshotManager.clearAll();
      abortAllFileStreams();
      persistentStore.set("lastWorkspace", resolved);
      logger.info("workspace", `opened ${resolved}`);
      startBackgroundIndex(senderWindow(event), resolved);
      startTreeWatcher(resolved);
      return resolved;
    })
  );

  ipcMain.handle(
    IPC.workspaceGet,
    wrap(() => workspaceService.getRoot())
  );

  ipcMain.handle(
    IPC.workspaceOpen,
    wrap(async (event: Electron.IpcMainInvokeEvent) => {
      const win = senderWindow(event);
      if (!win) return null;
      const result = await dialog.showOpenDialog(win, {
        title: "Open workspace folder",
        properties: ["openDirectory", "createDirectory"]
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const resolved = workspaceService.open(path.resolve(result.filePaths[0]));
      terminalService.registerWorkspaceCwd(resolved);
      snapshotManager.clearAll();
      abortAllFileStreams();
      persistentStore.set("lastWorkspace", resolved);
      logger.info("workspace", `opened ${resolved}`);
      startBackgroundIndex(win, resolved);
      startTreeWatcher(resolved);
      return resolved;
    })
  );

  ipcMain.handle(
    IPC.workspaceList,
    wrap((_e: Electron.IpcMainInvokeEvent, dir: string) => workspaceService.list(dir ?? "."))
  );

  ipcMain.handle(
    IPC.workspaceReadFile,
    wrap((_e: Electron.IpcMainInvokeEvent, target: string) => workspaceService.readFile(target))
  );

  ipcMain.handle(
    IPC.workspaceWriteFile,
    wrap(async (_e: Electron.IpcMainInvokeEvent, target: string, content: string) => {
      const root = workspaceService.requireRoot();
      let existed = false;
      try {
        existed = fs.existsSync(resolveWorkspacePath(root, target));
      } catch {
        existed = false;
      }
      const file = await workspaceService.writeFile(target, content);
      for (const win of BrowserWindow.getAllWindows()) {
        emitAgentEvent(win, {
          kind: "file_changed",
          runId: "user",
          timestamp: Date.now(),
          path: file.path,
          operation: existed ? "modify" : "create"
        });
      }
      return file;
    })
  );

  ipcMain.handle(
    IPC.workspacePatchFile,
    wrap((_e: Electron.IpcMainInvokeEvent, req: PatchRequest) => workspaceService.patchFile(req))
  );

  ipcMain.handle(
    IPC.workspaceSearch,
    wrap(
      (
        _e: Electron.IpcMainInvokeEvent,
        query: string,
        opts?: { regex?: boolean; include?: string; maxResults?: number; contextLines?: number }
      ) => workspaceService.search(query, opts)
    )
  );

  ipcMain.handle(
    IPC.workspaceScanImports,
    wrap(async (_e: Electron.IpcMainInvokeEvent, target: string) => {
      const root = workspaceService.requireRoot();
      const abs = resolveWorkspacePath(root, target);
      return scanImports(root, abs);
    })
  );

  ipcMain.handle(
    IPC.terminalRun,
    wrap(async (_e: Electron.IpcMainInvokeEvent, command: string, cwd?: string) => {
      const root = workspaceService.requireRoot();
      const id = randomUUID();
      return terminalService.run({ id, command, cwd: cwd ?? root });
    })
  );

  ipcMain.handle(IPC.terminalCancel, wrap((_e: Electron.IpcMainInvokeEvent, id: string) => terminalService.cancel(id)));
  ipcMain.handle(IPC.terminalStatus, wrap((_e: Electron.IpcMainInvokeEvent, id: string) => terminalService.status(id)));

  ipcMain.handle(
    IPC.agentRun,
    wrap(async (event: Electron.IpcMainInvokeEvent, task: string, chatId: string) => {
      const win = senderWindow(event);
      const runId = await agentManager.start(task, chatId, (agentEvent) => emitAgentEvent(win, agentEvent));
      return runId;
    })
  );

  ipcMain.handle(IPC.agentCancel, wrap((_e: Electron.IpcMainInvokeEvent, runId?: string | null) => agentManager.cancel(runId ?? null)));

  ipcMain.handle(
    IPC.agentRunning,
    wrap(() => agentManager.activeRuns())
  );

  ipcMain.handle(
    IPC.mergeList,
    wrap((_e: Electron.IpcMainInvokeEvent, runA: string, runB: string) => {
      const a = snapshotManager.mergeChanges(runA);
      const b = snapshotManager.mergeChanges(runB);
      const paths = [...new Set([...a.map((x) => x.path), ...b.map((x) => x.path)])].sort();
      return {
        files: paths.map((p) => ({
          path: p,
          a: a.find((x) => x.path === p) ?? null,
          b: b.find((x) => x.path === p) ?? null
        }))
      };
    })
  );

  ipcMain.handle(
    IPC.mergeApply,
    wrap(async (_e: Electron.IpcMainInvokeEvent, runId: string, targetPath: string) => {
      const root = workspaceService.requireRoot();
      const entry = snapshotManager.mergeChanges(runId).find((x) => x.path === targetPath);
      if (!entry) throw new Error(`That task never changed ${targetPath}.`);
      if (entry.after === null) {
        fileWatcher.markSelfWrite(resolveWorkspacePath(root, targetPath));
        await import("node:fs/promises").then(({ default: fsp }) => fsp.rm(resolveWorkspacePath(root, targetPath), { force: true }));
      } else {
        await workspaceService.writeFile(targetPath, entry.after);
      }
      for (const win of BrowserWindow.getAllWindows()) {
        emitAgentEvent(win, { kind: "file_changed", runId: "merge", timestamp: Date.now(), path: targetPath, after: entry.after ?? "", operation: "modify", summary: "merged from parallel task" });
      }
      return true;
    })
  );

  ipcMain.handle(
    IPC.vectorIndex,
    wrap(async (event: Electron.IpcMainInvokeEvent, rebuild?: boolean) => {
      const win = senderWindow(event);
      const root = workspaceService.requireRoot();
      const status = await vectorStore.index(root, embeddingConfig(), (done, total, note) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC.agentEvent, {
            kind: "index",
            runId: "indexer",
            timestamp: Date.now(),
            done,
            total,
            text: note
          } as AgentEvent);
        }
      }, rebuild === true);
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.agentEvent, { kind: "index", runId: "indexer", timestamp: Date.now(), status: "complete", done: status.files, total: status.files } as AgentEvent);
      }
      return status;
    })
  );

  ipcMain.handle(IPC.vectorStatus, wrap(() => vectorStore.status(workspaceService.getRoot())));

  ipcMain.handle(IPC.storeGet, wrap((_e: Electron.IpcMainInvokeEvent, key: PersistKey) => persistentStore.get(key)));
  ipcMain.handle(IPC.storeSet, wrap((_e: Electron.IpcMainInvokeEvent, key: PersistKey, value: unknown) => {
    if (key === "windowBounds") {
      persistentStore.set("windowBounds", sanitizeWindowBounds(value as WindowBounds | null));
    } else if (key === "lastWorkspace") {
      persistentStore.set("lastWorkspace", typeof value === "string" ? value : null);
    } else if (key === "recentModels") {
      persistentStore.set("recentModels", Array.isArray(value) ? (value as RecentModel[]).slice(0, 8) : []);
    } else if (key === "favorites") {
      persistentStore.set("favorites", Array.isArray(value) ? (value as string[]).filter((s) => typeof s === "string").slice(0, 40) : []);
    } else {
      throw new Error("key not allowed");
    }
    return true;
  }));
  ipcMain.handle(IPC.storeRememberModel, wrap((_e: Electron.IpcMainInvokeEvent, providerId: string, model: string) =>
    persistentStore.rememberModel(String(providerId), String(model))
  ));

  // ---- chunked file streaming (large logs / JSON / bundles) ----
  ipcMain.handle(
    IPC.fileReadStream,
    wrap(async (event, target: string) => {
      if (fileStreams.size >= MAX_ACTIVE_STREAMS) {
        for (const [, st] of fileStreams) {
          st.controller.abort();
          break;
        }
      }
      const root = workspaceService.requireRoot();
      const abs = resolveWorkspacePath(root, target);
      const size = fs.statSync(abs).size;
      const id = randomUUID();
      const win = senderWindow(event);
      const controller = new AbortController();
      fileStreams.set(id, { win, controller });
      let bytesSent = 0;
      void readFileChunked(
        abs,
        (chunk, progress) => {
          const st = fileStreams.get(id);
          if (!st || controller.signal.aborted) return;
          bytesSent += Buffer.byteLength(chunk);
          if (bytesSent > STREAM_LIMIT_BYTES) {
            controller.abort();
            fileStreams.delete(id);
            if (win && !win.isDestroyed()) {
              win.webContents.send(IPC.fileStreamChunk, {
                id,
                progress,
                done: true,
                error: `Streaming capped at ${Math.round(STREAM_LIMIT_BYTES / (1024 * 1024))} MB — the first part was sent.`
              });
            }
            return;
          }
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC.fileStreamChunk, { id, chunk, progress, done: false });
          }
        },
        () => {
          const st = fileStreams.get(id);
          fileStreams.delete(id);
          if (st && !controller.signal.aborted && st.win && !st.win.isDestroyed()) {
            st.win.webContents.send(IPC.fileStreamChunk, { id, progress: 100, done: true });
          }
        },
        (err) => {
          const st = fileStreams.get(id);
          fileStreams.delete(id);
          if (st?.win && !st.win.isDestroyed()) {
            st.win.webContents.send(IPC.fileStreamChunk, { id, progress: 0, done: true, error: err.message });
          }
        },
        controller.signal
      );
      return { id, size };
    })
  );

  ipcMain.handle(IPC.fileStreamAbort, wrap((_e, id: string) => {
    const st = fileStreams.get(id);
    if (st) {
      st.controller.abort();
      fileStreams.delete(id);
    }
    return true;
  }));

  // ---- diagnostics ----
  ipcMain.handle(IPC.uiRevealPath, wrap((_e, target: string) => {
    const userData = app.getPath("userData");
    const resolved = path.resolve(String(target ?? ""));
    if (!resolved.toLowerCase().startsWith(userData.toLowerCase())) {
      throw new Error("Only utcode data files can be revealed.");
    }
    if (fs.existsSync(resolved)) shell.showItemInFolder(resolved);
    else shell.showItemInFolder(path.join(userData, path.basename(resolved)));
    return true;
  }));

  ipcMain.handle(IPC.appDiagnostics, wrap(() => {
    const root = workspaceService.getRoot();
    const logPath = path.join(app.getPath("userData"), LOG_FILE);
    let lastErrors: string[] = [];
    try {
      if (fs.existsSync(logPath)) {
        const fd = fs.openSync(logPath, "r");
        const size = fs.fstatSync(fd).size;
        const len = Math.min(size, 65536);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, Math.max(0, size - len));
        fs.closeSync(fd);
        lastErrors = buf
          .toString("utf-8")
          .split(/\r?\n/)
          .filter((l) => /\[ERROR\]|\[WARN\]/.test(l))
          .slice(-6)
          .map((l) => l.slice(0, 240));
      }
    } catch {
      /* diagnostics must never throw on log reads */
    }
    const settings = settingsStore.get();
    const active = settings.activeProviderId
      ? settingsStore.getPublicProviders().find((x) => x.id === settings.activeProviderId) ?? null
      : null;
    const vector = vectorStore.status(root);
    return {
      appVersion: APP_VERSION,
      electron: process.versions.electron ?? "?",
      node: process.versions.node ?? "?",
      chromium: process.versions.chrome ?? "?",
      v8: process.versions.v8 ?? "?",
      platform: process.platform,
      arch: process.arch,
      userDataPath: app.getPath("userData"),
      logPath,
      workspace: root,
      runningAgents: agentManager.activeRuns().length,
      watcherActive: fileWatcher.isRunning(),
      vectorFiles: vector.files,
      vectorChunks: vector.chunks,
      vectorBackend: vector.backend,
      providerCount: settingsStore.getPublicProviders().length,
      activeProvider: active ? `${active.name} · ${active.model}` : null,
      lastErrors
    };
  }));

  ipcMain.handle(
    IPC.agentRestore,
    wrap(async (event: Electron.IpcMainInvokeEvent, runId: string, callId: string, resume: boolean) => {
      const win = senderWindow(event);
      if (typeof runId !== "string" || typeof callId !== "string" || callId.length === 0) {
        throw new Error("restore requires a run id and checkpoint id.");
      }
      return agentManager.restore(runId, callId, resume === true, (agentEvent) => emitAgentEvent(win, agentEvent));
    })
  );

  ipcMain.handle(IPC.providerList, wrap(() => settingsStore.getPublicProviders()));

  ipcMain.handle(
    IPC.providerSave,
    wrap((_e: Electron.IpcMainInvokeEvent, provider: ProviderInput) => {
      if (!provider || typeof provider.id !== "string" || provider.id.trim().length === 0) {
        throw new Error("Provider id is required.");
      }
      if (!provider.name?.trim()) throw new Error("Provider name is required.");
      if (!provider.model?.trim()) throw new Error("Model name is required.");
      if (provider.type === "openai-compatible" && !provider.baseUrl?.trim()) {
        throw new Error("Base URL is required for custom OpenAI-compatible providers.");
      }
      if (provider.apiKey && /[\r\n]/.test(provider.apiKey)) {
        throw new Error("API key contains invalid characters.");
      }
      return settingsStore.saveProvider(provider);
    })
  );

  ipcMain.handle(IPC.providerDelete, wrap((_e: Electron.IpcMainInvokeEvent, id: string) => {
    settingsStore.deleteProvider(id);
    return true;
  }));

  ipcMain.handle(IPC.providerTest, wrap((_e: Electron.IpcMainInvokeEvent, id: string) => providerManager.test(id)));

  ipcMain.handle(IPC.providerFetchModels, wrap((_e: Electron.IpcMainInvokeEvent, id: string) => providerManager.fetchModels(id)));

  ipcMain.handle(IPC.providerSetDefault, wrap((_e: Electron.IpcMainInvokeEvent, id: string | null) => {
    settingsStore.setDefaultProvider(id);
    return true;
  }));

  ipcMain.handle(IPC.mcpList, wrap(() => mcpManager.statuses()));

  ipcMain.handle(IPC.mcpSave, wrap((_e: Electron.IpcMainInvokeEvent, server: McpServerConfig) => {
    mcpManager.saveServer(server);
    return mcpManager.statuses();
  }));

  ipcMain.handle(IPC.mcpDelete, wrap((_e: Electron.IpcMainInvokeEvent, name: string) => {
    mcpManager.deleteServer(name);
    return mcpManager.statuses();
  }));

  ipcMain.handle(IPC.mcpConnect, wrap(async (_e: Electron.IpcMainInvokeEvent, name: string) => mcpManager.connect(name)));
  ipcMain.handle(IPC.mcpDisconnect, wrap(async (_e: Electron.IpcMainInvokeEvent, name: string) => mcpManager.disconnect(name)));
  ipcMain.handle(IPC.mcpTools, wrap((_e: Electron.IpcMainInvokeEvent, name: string) => mcpManager.toolsFor(name)));

  ipcMain.handle(
    IPC.mcpImport,
    wrap(async (event: Electron.IpcMainInvokeEvent) => {
      const win = senderWindow(event);
      if (!win) throw new Error("No window available.");
      const result = await dialog.showOpenDialog(win, {
        title: "Import mcp_config.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["openFile"]
      });
      if (result.canceled || result.filePaths.length === 0) throw new Error("Import cancelled.");
      return mcpManager.importFromFile(result.filePaths[0]);
    })
  );

  ipcMain.handle(IPC.settingsGet, wrap(() => settingsStore.get()));
  ipcMain.handle(
    IPC.settingsSave,
    wrap((_e: Electron.IpcMainInvokeEvent, patch: Parameters<typeof settingsStore.update>[0]) => {
      const updated = settingsStore.update(patch);
      const theme = updated.ui.theme;
      const customBg = updated.ui.custom?.bg ?? "";
      const light =
        theme === "light" ||
        (theme === "custom" && (() => {
          const h = customBg.replace("#", "");
          if (h.length !== 6) return false;
          const n = parseInt(h, 16);
          return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 140;
        })());
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.setTitleBarOverlay({
            color: light ? "#eae6de" : "#181818",
            symbolColor: light ? "#26221e" : "#e0e0e0",
            height: 36
          });
        } catch {
          /* overlay unsupported on some platforms */
        }
      }
      return updated;
    })
  );

  ipcMain.handle(IPC.chatList, wrap(() => chatStore.list()));
  ipcMain.handle(IPC.chatSave, wrap((_e: Electron.IpcMainInvokeEvent, chat: Chat) => chatStore.save(chat)));
  ipcMain.handle(IPC.chatDelete, wrap((_e: Electron.IpcMainInvokeEvent, id: string) => chatStore.delete(id)));

  ipcMain.handle(IPC.uiOpenExternal, wrap(async (_e: Electron.IpcMainInvokeEvent, url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Invalid URL.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "mailto:") {
      throw new Error(`Refusing to open unsafe URL protocol: ${parsed.protocol}`);
    }
    await shell.openExternal(parsed.toString());
    return true;
  }));

  ipcMain.handle(IPC.uiOpenFileDialog, wrap(async (event: Electron.IpcMainInvokeEvent) => {
    const win = senderWindow(event);
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, { properties: ["openFile"] });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
  }));

  ipcMain.handle(IPC.uiSaveFileDialog, wrap(async (event: Electron.IpcMainInvokeEvent, name: string) => {
    const win = senderWindow(event);
    if (!win) return { canceled: true };
    const result = await dialog.showSaveDialog(win, { defaultPath: name || "file.txt" });
    if (result.canceled || !result.filePath) return { canceled: true };
    return { canceled: false, path: result.filePath };
  }));

  logger.info("ipc", "handlers registered");
}
