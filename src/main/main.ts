import { app, BrowserWindow, nativeImage, nativeTheme, net, protocol, screen, session, shell } from "electron";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BACKGROUND_COLOR, PREVIEW_PARTITION, WINDOW_DEFAULT_HEIGHT, WINDOW_DEFAULT_WIDTH, WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH } from "../shared/constants";
import { registerIpcHandlers } from "./ipcHandlers";
import { friendlyError, logger } from "./services/logger";
import { settingsStore } from "./services/settingsStore";
import { mcpManager } from "./mcp/mcpManager";
import { terminalService } from "./terminal/terminalService";
import { workspaceService } from "./workspace/workspaceService";
import { resolveWorkspacePath } from "./workspace/pathSecurity";
import { scanImports } from "./fileSystem/importScanner";
import { vectorStore } from "./agent/vectorStore";
import { fileWatcher } from "./fileSystem/fileWatcher";
import { readFileChunked } from "./fileSystem/fileIO";
import { persistentStore, sanitizeWindowBounds, boundsOnScreen } from "./store/persistentStore";
import { workspaceLocks } from "./agent/workspaceLocks";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.VITE_DEV_SERVER_URL;

/**
 * Low Memory Mode (Settings → Appearance). Hardware acceleration must be
 * disabled BEFORE app is ready, so we peek at the persisted settings.json
 * synchronously here. Default OFF: GPU/WebGL stays enabled and previews work;
 * previews are only ever "slower", never broken, when the user opts in.
 */
try {
  const peeked = JSON.parse(fsSync.readFileSync(path.join(app.getPath("userData"), "settings.json"), "utf-8")) as { ui?: { lowMemoryMode?: boolean } };
  if (peeked?.ui?.lowMemoryMode === true) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch("disable-gpu-compositing");
  }
} catch {
  /* first run / unreadable — default (GPU on) */
}

/** Preview requests get a relaxed CSP; the main app window keeps its strict CSP. */
const PREVIEW_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: data: utcode-preview:; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; font-src 'self' data: blob:; media-src 'self' data: blob:; worker-src 'self' blob: data:; connect-src 'self' blob: data: ws: wss: utcode-preview:;";

const PREVIEW_MIME: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".cjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".map": "application/json", ".txt": "text/plain", ".xml": "application/xml",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".ico": "image/x-icon", ".bmp": "image/bmp", ".avif": "image/avif",
  ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".opus": "audio/ogg",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp4": "video/mp4", ".webm": "video/webm", ".webmanifest": "application/manifest+json"
};

// Must run before app 'ready': makes utcode-preview a real origin so fetch(),
// dynamic import, workers and relative asset URLs behave like a web server.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "utcode-preview",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true }
  }
]);

async function handlePreviewRequest(request: Request): Promise<Response> {
  const root = workspaceService.getRoot();
  if (!root) return new Response("No workspace is open.", { status: 503, headers: { "content-type": "text/plain" } });
  try {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel.startsWith("/")) rel = rel.slice(1);
    if (rel.length === 0 || rel.endsWith("/")) rel += "index.html";
    const abs = resolveWorkspacePath(root, rel.split("/").join(path.sep)); // throws on traversal -> 403
    const upstream = await net.fetch(pathToFileURL(abs).toString());
    const headers = new Headers();
    headers.set("content-type", PREVIEW_MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream");
    headers.set("content-security-policy", PREVIEW_CSP);
    headers.set("access-control-allow-origin", "*");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e && (e.name === "PathSecurityError" || e.code === "EPERM")) {
      return new Response("403 - path outside the workspace is not allowed", { status: 403, headers: { "content-type": "text/plain" } });
    }
    return new Response(`404 - ${String(e?.message ?? err)}`, { status: 404, headers: { "content-type": "text/plain" } });
  }
}

function guestConsoleToLine(args: unknown[]): { level: "log" | "info" | "warning" | "error"; message: string; line?: number; source?: string } {
  const first = args[0] as Record<string, unknown> | undefined;
  if (typeof first === "object" && first !== null && "message" in first) {
    const raw = String(first.level ?? "log");
    const level = raw === "warning" ? "warning" : raw === "error" ? "error" : raw === "info" ? "info" : "log";
    return {
      level,
      message: String(first.message ?? ""),
      line: typeof first.lineNumber === "number" ? first.lineNumber : undefined,
      source: typeof first.sourceId === "string" ? first.sourceId : undefined
    };
  }
  const n = Number(args[1]);
  const legacy = ["log", "info", "warning", "error"][Number.isFinite(n) ? n : 0] ?? "log";
  return {
    level: legacy === "verbose" || legacy === "debug" ? "log" : (legacy as "log" | "info" | "warning" | "error"),
    message: String(args[2] ?? ""),
    line: Number.isFinite(Number(args[3])) ? Number(args[3]) : undefined,
    source: typeof args[4] === "string" ? args[4] : undefined
  };
}

let mainWindow: BrowserWindow | null = null;

function applyTheme(): void {
  const theme = settingsStore.get().ui.theme;
  nativeTheme.themeSource = theme === "light" ? "light" : theme === "system" ? "system" : "dark";
}

function windowIcon(): Electron.NativeImage | undefined {
  const candidate = isDev
    ? path.join(app.getAppPath(), "buildResources", "icon.png")
    : path.join(process.resourcesPath, "icon.png");
  try {
    if (fsSync.existsSync(candidate)) {
      const img = nativeImage.createFromPath(candidate);
      return img.isEmpty() ? undefined : img;
    }
  } catch {
    /* no icon available */
  }
  return undefined;
}

function createWindow(): void {
  let bounds: { width: number; height: number; x?: number; y?: number } | null = null;
  let startMaximized = false;
  try {
    const saved = persistentStore.get("windowBounds");
    const safe = saved ? sanitizeWindowBounds(saved) : null;
    if (safe && boundsOnScreen(safe, screen.getAllDisplays().map((d) => d.bounds))) {
      bounds = { width: safe.width, height: safe.height, x: safe.x, y: safe.y };
      startMaximized = safe.maximized === true;
    }
  } catch {
    /* fall back to defaults */
  }
  mainWindow = new BrowserWindow({
    title: "utcode",
    icon: windowIcon(),
    width: bounds?.width ?? WINDOW_DEFAULT_WIDTH,
    height: bounds?.height ?? WINDOW_DEFAULT_HEIGHT,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    backgroundColor: BACKGROUND_COLOR,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#181818",
      symbolColor: "#e0e0e0",
      height: 36
    },
    webPreferences: {
      preload: path.join(dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      webviewTag: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (startMaximized) mainWindow?.maximize();
    mainWindow?.show();
  });

  // persist window bounds (debounced) so the app reopens where you left it
  let boundsTimer: NodeJS.Timeout | null = null;
  const win = mainWindow;
  const saveBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      try {
        if (!win.isDestroyed()) {
          persistentStore.set("windowBounds", { ...win.getBounds(), maximized: win.isMaximized() });
        }
      } catch {
        /* ignore */
      }
    }, 400);
  };
  win.on("resize", saveBounds);
  win.on("move", saveBounds);
  win.on("close", () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    try {
      if (!win.isDestroyed()) {
        persistentStore.set("windowBounds", { ...win.getBounds(), maximized: win.isMaximized() });
      }
    } catch {
      /* ignore */
    }
  });

  // Isolation: a preview <webview> guest runs in its own renderer process.
  // Pipe its console output and crashes to the UI instead of letting them
  // take down (or silently blank) the main window.
  mainWindow.webContents.on("did-attach-webview", (_event, guest) => {
    guest.on("console-message", (...args: unknown[]) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("preview:console", guestConsoleToLine(args));
      }
    });
    guest.on("render-process-gone", (_e, details) => {
      logger.warn("preview", `guest render-process-gone: ${JSON.stringify(details)}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("preview:crashed", { reason: String(details?.reason ?? "crashed") });
      }
    });
    guest.on("preload-error", (_e, preloadPath, error) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("preview:console", {
          level: "error",
          message: `Preload failed (${path.basename(String(preloadPath))}): ${error instanceof Error ? error.message : String(error)}`,
          at: Date.now()
        });
      }
    });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? "";
    if (isDev && (url.startsWith("http://localhost:5173") || url.startsWith("http://127.0.0.1:5173"))) return;
    if (current.startsWith("file:") && url.startsWith("file:")) return;
    event.preventDefault();
    if (url.startsWith("https://")) void shell.openExternal(url);
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    void mainWindow.loadFile(path.join(dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function shutdown(): Promise<void> {
  try {
    fileWatcher.stop();
    terminalService.cancelAll();
    await mcpManager.disconnectAll();
  } catch (err) {
    logger.warn("main", `shutdown cleanup: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runSelfTests(win: BrowserWindow): Promise<void> {
  const failures: string[] = [];
  const rendererErrors: string[] = [];
  win.webContents.on("console-message", (...args: unknown[]) => {
    let message = "";
    const first = args[0];
    if (typeof first === "object" && first !== null && "message" in first) {
      message = String((first as { message?: unknown }).message ?? "");
    } else if (typeof args[2] === "string") {
      message = args[2];
    }
    if (/maximum update depth|uncaught|the above error occurred/i.test(message)) {
      rendererErrors.push(message.slice(0, 300));
    }
  });
  const check = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
      logger.info("smoke", `PASS ${name}`);
    } catch (err) {
      const { message } = friendlyError(err);
      failures.push(`${name}: ${message}`);
      logger.error("smoke", `FAIL ${name}: ${message}`);
    }
  };
  const assert = (cond: boolean, msg: string): void => {
    if (!cond) throw new Error(msg);
  };

  const preloadOk = (await win.webContents.executeJavaScript(
    "!!window.utcode && typeof window.utcode.appInfo === 'function' && typeof window.utcode.agentRun === 'function'"
  )) as boolean;
  assert(preloadOk, "preload bridge missing on renderer window");

  await new Promise((resolve) => setTimeout(resolve, 2500));
  await check("renderer:stable", async () => {
    assert(rendererErrors.length === 0, `renderer reported React errors: ${rendererErrors.join(" | ")}`);
  });

  const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "utcode-selftest-"));
  try {
    workspaceService.open(tmp, false);
    terminalService.registerWorkspaceCwd(tmp);
    await check("ipc:appInfo", async () => {
      const v = (await win.webContents.executeJavaScript("window.utcode.appInfo().then(r => r.data.version)")) as string;
      assert(typeof v === "string" && v.length > 0, "no version from appInfo");
    });
    await check("workspace:write+read", async () => {
      await workspaceService.writeFile("src/app.ts", "export const x = 1;\nimport './dep';\n");
      const file = await workspaceService.readFile("src/app.ts");
      assert(file.content.includes("export const x"), "content mismatch");
    });
    await check("workspace:patch", async () => {
      await workspaceService.writeFile("cfg.txt", "alpha\nbeta\ngamma\n");
      const res = await workspaceService.patchFile({ path: "cfg.txt", search: "beta", replace: "BETA" });
      assert(res.applied && res.linesAdded === 1, "patch not applied");
      const file = await workspaceService.readFile("cfg.txt");
      assert(file.content === "alpha\nBETA\ngamma\n", "patched content wrong");
    });
    await check("workspace:traversal-rejected", async () => {
      let threw = false;
      try {
        await workspaceService.readFile("../../Windows/win.ini");
      } catch {
        threw = true;
      }
      assert(threw, "path traversal was NOT rejected");
    });
    await check("workspace:search", async () => {
      const res = await workspaceService.search("BETA");
      assert(res.matches.some((m) => m.path === "cfg.txt"), "search missed known text");
    });
    await check("imports:scan", async () => {
      await workspaceService.writeFile("src/dep.ts", "export const dep = 2;\n");
      const report = await scanImports(tmp, path.join(tmp, "src", "app.ts"));
      assert(report.imports.some((i) => i.resolvedPath === "src/dep.ts"), "import not resolved");
    });
    await check("vector:lexical-index+search", async () => {
      const st = await vectorStore.index(tmp, null);
      assert(st.chunks > 0, "vector index produced no chunks");
      const { hits } = await vectorStore.search(tmp, "patch content inside app file", 3, null);
      assert(hits.length > 0, "semantic_search returned no hits");
    });
    await check("ghost:workspace-locks", async () => {
      const a = workspaceLocks.acquire(["src/api.ts"], "runA");
      assert(a.ok, "first acquire failed");
      const b = workspaceLocks.acquire(["src/api.ts"], "runB");
      assert(!b.ok, "second run was allowed to edit a locked file!");
      workspaceLocks.release("runA");
      const c = workspaceLocks.acquire(["src/api.ts"], "runB");
      assert(c.ok, "lock was not released");
      workspaceLocks.release("runB");
    });
    await check("file:chunked-stream", async () => {
      const big = path.join(tmp, "big-log.txt");
      const line = "x".repeat(1024);
      fsSync.writeFileSync(big, `${line}\n`.repeat(2560));
      let received = 0;
      let lastProgress = 0;
      await new Promise<void>((resolve, reject) => {
        readFileChunked(
          big,
          (chunk, progress) => {
            received += Buffer.byteLength(chunk);
            lastProgress = progress;
          },
          () => resolve(),
          (err) => reject(err)
        );
      });
      assert(received >= 2560 * 1024, `only ${received} bytes streamed`);
      assert(lastProgress >= 95, `progress ended at ${lastProgress}%`);
    });
    await check("ipc:diagnostics", async () => {
      const plat = (await win.webContents.executeJavaScript(
        "window.utcode.appDiagnostics().then((r) => (r.success && r.data && r.data.platform ? String(r.data.platform) : 'FAIL'))"
      )) as string;
      assert(plat !== "FAIL" && plat.length > 0, "appDiagnostics IPC failed");
    });
    await check("persistence:store", async () => {
      const round = (await win.webContents.executeJavaScript(`(async () => {
        await window.utcode.storeSet("recentModels", [{ providerId: "p-x", model: "m-1" }]);
        const got = await window.utcode.storeGet("recentModels");
        const bad = await window.utcode.storeSet("windowBounds", { width: 5, height: 5 });
        const stored = await window.utcode.storeGet("windowBounds");
        return JSON.stringify({
          ok: got.success && Array.isArray(got.data) && got.data[0]?.model === "m-1",
          rejectsBogus: bad.success && stored.data === null
        });
      })()`)) as string;
      const r = JSON.parse(round) as { ok: boolean; rejectsBogus: boolean };
      assert(r.ok, "persistent store round-trip failed");
      assert(r.rejectsBogus, "bogus window bounds were not sanitized to null");
    });
    await check("chat:workspace-stamp", async () => {
      const stamped = (await win.webContents.executeJavaScript(`(async () => {
        await window.__utcodeDebug.openWorkspace(${JSON.stringify(tmp)});
        await new Promise((r) => setTimeout(r, 400));
        window.__utcodeDebug.seedLocalChat("stamp test");
        await new Promise((r) => setTimeout(r, 250));
        const s1 = JSON.parse(window.__utcodeDebug.snapshot());
        const rootOk = !!s1.chatRoot;
        return JSON.stringify({ rootOk, chatRoot: s1.chatRoot, tmp: ${JSON.stringify(tmp)} });
      })()`)) as string;
      const s = JSON.parse(stamped) as { rootOk: boolean; chatRoot: string | null; tmp: string };
      assert(s.rootOk && String(s.chatRoot).toLowerCase() === String(s.tmp).toLowerCase(), `chat workspaceRoot not stamped (${s.chatRoot})`);
    });
    await check("chat:workspace-switch", async () => {
      const wsA = path.join(tmp, "wsa");
      const wsB = path.join(tmp, "wsb");
      fsSync.mkdirSync(wsA, { recursive: true });
      fsSync.mkdirSync(wsB, { recursive: true });
      fsSync.writeFileSync(path.join(wsA, "a.txt"), "a");
      fsSync.writeFileSync(path.join(wsB, "b.txt"), "b");
      const r = (await win.webContents.executeJavaScript(`(async () => {
        try {
          await window.__utcodeDebug.openWorkspace(${JSON.stringify(wsA)});
          const idA = window.__utcodeDebug.seedLocalChat("work in A");
          await window.__utcodeDebug.openWorkspace(${JSON.stringify(wsB)});
          window.__utcodeDebug.seedLocalChat("work in B");
          const beforeRoot = JSON.parse(window.__utcodeDebug.snapshot()).chatRoot;
          await window.__utcodeDebug.openChatById(idA);
          await new Promise((r2) => setTimeout(r2, 900));
          const after = JSON.parse(window.__utcodeDebug.snapshot());
          await window.__utcodeDebug.openWorkspace(${JSON.stringify(tmp)});
          return JSON.stringify({ beforeRoot: String(beforeRoot), afterRoot: String(after.chatRoot) });
        } catch (err) {
          try {
            await window.__utcodeDebug.openWorkspace(${JSON.stringify(tmp)});
          } catch {
            /* best effort */
          }
          return "ERR:" + String(err && err.message ? err.message : err);
        }
      })()`)) as string;
      if (r.startsWith("ERR:")) throw new Error(r.slice(0, 160));
      const c = JSON.parse(r) as { beforeRoot: string; afterRoot: string };
      const norm = (v: string): string => String(v).toLowerCase().split("\\").join("/").replace(/\/+$/, "");
      assert(norm(c.beforeRoot) === norm(wsB), `chat B workspaceRoot wrong (${c.beforeRoot})`);
      assert(norm(c.afterRoot) === norm(wsA), `opening chat A did not auto-switch workspace back (${c.afterRoot})`);
    });
    await check("ui:monaco-editor", async () => {
      const rendered = (await win.webContents.executeJavaScript(`(async () => {
        try {
          await window.__utcodeDebug.seedChat();
          await new Promise((r) => setTimeout(r, 300));
          window.__utcodeDebug.openWorkspace(${JSON.stringify(tmp)});
          await new Promise((r) => setTimeout(r, 400));
          await window.__utcodeDebug.openFile("cfg.txt");
          await new Promise((r) => setTimeout(r, 2500));
          window.__utcodeDebug.setPanelTab("code");
          await new Promise((r) => setTimeout(r, 500));
          return !!document.querySelector(".monaco-editor");
        } catch (err) {
          return String(err && err.message ? err.message : err);
        }
      })()`)) as unknown;
      assert(rendered === true, `Monaco editor did not mount in the Code tab (renderer said: ${String(rendered).slice(0, 200)})`);
    });
    await check("ui:brand-mark", async () => {
      const hasMark = (await win.webContents.executeJavaScript(
        `(function(){ var svg = document.querySelector("aside svg"); if (!svg) return false; var path = svg.querySelector("path"); var lines = svg.querySelectorAll("line"); return !!path && lines.length === 3 && (path.getAttribute("stroke")||"").toUpperCase() === "#D97757"; })()`
      )) as boolean;
      assert(hasMark, "UtcodeLogo hexagon+spark SVG is not rendering in the sidebar");
    });
    await check("ui:sidebar-toggle", async () => {
      const res = (await win.webContents.executeJavaScript(`(async () => {
        try {
          const aside = () => document.querySelector("aside");
          const wrap = () => {
            const a = aside();
            return a && a.parentElement ? a.parentElement.getBoundingClientRect().width : 0;
          };
          const closedInitially = wrap() < 10;
          window.__utcodeDebug.setSidebar(true);
          let openW = 0;
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 100));
            openW = wrap();
            if (openW >= 220) break;
          }
          window.__utcodeDebug.setSidebar(false);
          let closedAgain = false;
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 100));
            closedAgain = wrap() < 10;
            if (closedAgain) break;
          }
          return JSON.stringify({ closedInitially, openW, closedAgain });
        } catch (err) {
          return "ERR:" + String(err && err.message ? err.message : err);
        }
      })()`)) as string;
      if (res.startsWith("ERR:")) throw new Error(res.slice(0, 200));
      const parsed = JSON.parse(res) as { closedInitially: boolean; openW: number; closedAgain: boolean };
      assert(parsed.closedInitially, "sidebar should be hidden by default on launch");
      assert(parsed.openW >= 220 && parsed.openW <= 320, `sidebar open width should be a compact 220-300px, got ${parsed.openW}`);
      assert(parsed.closedAgain, "sidebar should collapse again after toggle-off");
    });
    await check("ui:titlebar", async () => {
      const has = (await win.webContents.executeJavaScript("!!document.querySelector('[data-titlebar]') && !!document.querySelector('[data-titlebar]').offsetParent")) as boolean;
      assert(has, "custom dark TitleBar with overlay controls not mounted");
    });
    await check("ui:preview", async () => {
      const okPreview = (await win.webContents.executeJavaScript(`(async () => {
        try {
          window.__utcodeDebug.setPanelTab("preview");
          await new Promise((r) => setTimeout(r, 800));
          const el = document.querySelector("webview");
          return !!el && String(el.getAttribute("src") || "").startsWith("utcode-preview:");
        } catch {
          return false;
        }
      })()`)) as boolean;
      assert(okPreview, "Preview tab did not mount a <webview> with a utcode-preview:// URL");
    });
    await check("preview:serve", async () => {
      const marker = "__utcode_preview_marker__";
      fsSync.writeFileSync(path.join(tmp, "preview-test.html"), `<!doctype html><title>${marker}</title><script src="./preview-lib.js"></script>`);
      fsSync.writeFileSync(path.join(tmp, "preview-lib.js"), `console.log("lib loaded");`);
      const res = await net.fetch("utcode-preview://workspace/preview-test.html");
      assert(res.ok, `preview protocol fetch status ${res.status}`);
      assert((res.headers.get("content-type") ?? "").includes("text/html"), "missing html mime");
      assert((res.headers.get("content-security-policy") ?? "").includes("unsafe-eval"), "preview CSP must allow unsafe-eval for shader compilation");
      const body = await res.text();
      assert(body.includes(marker), "preview page content not served");
      const sub = await net.fetch(new URL("./preview-lib.js", "utcode-preview://workspace/preview-test.html").toString());
      assert(sub.ok && (sub.headers.get("content-type") ?? "").includes("javascript"), "relative subresource (script asset) not served");
      const evil = await net.fetch("utcode-preview://workspace/%2e%2e%2f%2e%2e%2fsecrets.json");
      assert(evil.status === 403 || evil.status === 404, "path traversal was not blocked");
      // Regression guard for the "Windows needs a new app" handoff: the PREVIEW
      // webview's partition session (not just the default session) MUST resolve
      // utcode-preview:// internally, or Chromium hands it to the OS shell.
      const partRes = await session.fromPartition(PREVIEW_PARTITION).fetch("utcode-preview://workspace/preview-test.html");
      assert(partRes.ok, "partition session has no internal utcode-preview:// handler (would leak to Windows)");
    });
    await check("ui:filetree-live", async () => {
      const name = `wtest-${Date.now().toString(36)}.js`;
      const has = (n: string): Promise<boolean> =>
        win.webContents.executeJavaScript(
          `[...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes(${JSON.stringify(n)}))`
        ) as Promise<boolean>;
      fsSync.writeFileSync(path.join(tmp, name), "// created externally by the watcher self-test\n");
      let shown = false;
      for (let i = 0; i < 12 && !shown; i++) {
        await new Promise((r) => setTimeout(r, 250));
        shown = await has(name);
      }
      assert(shown, `externally created ${name} did not appear in the file tree within ~3s`);
      fsSync.rmSync(path.join(tmp, name), { force: true });
      let gone = false;
      for (let i = 0; i < 12 && !gone; i++) {
        await new Promise((r) => setTimeout(r, 250));
        gone = !(await has(name));
      }
      assert(gone, "deleted file is still listed in the tree");
    });
    await check("watcher:loop-guard", async () => {
      fileWatcher.setAgentWorking(true);
      fsSync.writeFileSync(path.join(tmp, "loopguard-1.txt"), "// written while agent-busy\n");
      await new Promise((r) => setTimeout(r, 800));
      const dropped = fileWatcher.droppedWhileBusyCount;
      fileWatcher.setAgentWorking(false);
      let shown = false;
      for (let i = 0; i < 12 && !shown; i++) {
        await new Promise((r) => setTimeout(r, 200));
        shown = (await win.webContents.executeJavaScript(
          `[...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("loopguard-1.txt"))`
        )) as boolean;
      }
      logger.info("smoke", `watcher:loop-guard dropped=${dropped}`);
      assert(shown, "post-run flush did not refresh the tree — files written during a run would never appear");
      fsSync.rmSync(path.join(tmp, "loopguard-1.txt"), { force: true });
    });
    await check("chat:delete-scoping", async () => {
      const out = (await win.webContents.executeJavaScript(`(async () => {
        try {
          const baselineIds = window.__utcodeDebug.chatIds();
          await window.__utcodeDebug.seedChat();
          await window.__utcodeDebug.newTaskChat();
          const afterSeed = window.__utcodeDebug.chatIds();
          const created = afterSeed.filter((id) => !baselineIds.includes(id));
          const two = JSON.parse(window.__utcodeDebug.snapshot());
          two.baseline = baselineIds.length;
          // delete ONLY the chats we created, never a pre-existing user chat
          window.__utcodeDebug.deleteChatById(created[created.length - 1]);
          await new Promise((r) => setTimeout(r, 400));
          const one = JSON.parse(window.__utcodeDebug.snapshot());
          window.__utcodeDebug.deleteChatById(created[0]);
          await new Promise((r) => setTimeout(r, 500));
          const zero = JSON.parse(window.__utcodeDebug.snapshot());
          return JSON.stringify({ two, one, zero, created: created.length, scratchStillRunning: created.some((id) => (zero.runningIds || []).includes(id)) });
        } catch (err) {
          return "ERR:" + String(err && err.message ? err.message : err);
        }
      })()`)) as string;
      if (typeof out === "string" && out.startsWith("ERR:")) throw new Error(out.slice(0, 200));
      const r = JSON.parse(out) as {
        two: { baseline: number; n: number };
        one: { n: number; activeHasMessages: boolean };
        zero: { n: number; running: boolean; dash: boolean; runningIds: string[] };
        created: number;
        scratchStillRunning: boolean;
      };
      assert(r.created === 2, `expected to create 2 scratch chats, created ${r.created}`);
      assert(r.two.n === r.two.baseline + 2, `seeding 2 chats should add 2 to the baseline (got ${r.two.n}, baseline ${r.two.baseline})`);
      assert(r.one.n === r.two.n - 1, `deleting one chat must remove ONLY that chat (expected ${r.two.n - 1}, got ${r.one.n})`);
      assert(r.zero.n === r.two.baseline, `deleting the two scratch chats must restore the baseline count (expected ${r.two.baseline}, got ${r.zero.n})`);
      assert(r.scratchStillRunning === false, "a deleted scratch chat's agent is still tracked as running (zombie)");
      void r.zero.dash;
    });
    await check("terminal:run", async () => {
      const result = await terminalService.run({ id: "selftest", command: "echo utcode-terminal-ok", cwd: tmp });
      assert(result.exitCode === 0 && result.stdout.includes("utcode-terminal-ok"), `terminal output wrong (${result.exitCode})`);
    });
    await check("terminal:failure-safe", async () => {
      const result = await terminalService.run({ id: "selftest2", command: "definitely-not-a-command-xyz", cwd: tmp });
      assert(result.exitCode !== 0, "failing command reported success");
    });
    await check("settings:roundtrip", async () => {
      const s = settingsStore.get();
      assert(typeof s.agent.maxIterations === "number" && s.agent.maxIterations > 0, "defaults missing");
    });
    await check("mcp:config-validate", async () => {
      mcpManager.load();
      assert(Array.isArray(mcpManager.listServers()), "mcp list broken");
    });
    const serverScript = path.join(dirname, "..", "scripts", "mcp-test-server.mjs");
    if (fsSync.existsSync(serverScript)) {
      try {
        await check("mcp:live-connect+tool", async () => {
          mcpManager.saveServer({ name: "utcode-selftest", command: "node", args: [serverScript] });
          try {
            await mcpManager.connect("utcode-selftest");
            const tools = mcpManager.allAgentTools();
            assert(tools.some((t) => t.name === "mcp.utcode-selftest.echo"), `namespaced echo tool missing (${tools.length} tools)`);
            const tool = tools.find((t) => t.name === "mcp.utcode-selftest.echo")!;
            const result = await tool.execute(
              { message: "ping" },
              { workspaceRoot: tmp, runId: "selftest", callId: "selftest-call", signal: new AbortController().signal, emitEvent: () => undefined }
            );
            assert(result.ok && result.content.includes("echo: ping"), `mcp tool call failed: ${result.content}`);
          } finally {
            await mcpManager.disconnect("utcode-selftest").catch(() => undefined);
            mcpManager.deleteServer("utcode-selftest");
          }
        });
      } catch {
        /* check() already recorded the failure */
      }
    } else {
      logger.warn("smoke", "mcp-test-server script not found; skipping live MCP check");
    }
  } finally {
    // The preview <webview> may hold a lock on the temp workspace (file:///.../index.html).
    // Navigate it away and drop the tab before deleting, so rmSync is deterministic.
    try {
      await win.webContents.executeJavaScript(`(async () => {
        window.__utcodeDebug.setPanelTab("code");
        await new Promise((r) => setTimeout(r, 300));
        return true;
      })()`);
    } catch {
      /* renderer may be closing */
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        fsSync.rmSync(tmp, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    workspaceService.close();
  }

  if (failures.length > 0) {
    logger.error("smoke", `SELF-TEST FAILURES: ${failures.join(" | ")}`);
    await shutdown();
    app.exit(3);
  } else {
    logger.info("smoke", "ALL SELF-TESTS PASSED");
    await shutdown();
    app.exit(0);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    if (process.platform === "win32") app.setAppUserModelId("com.utcode.desktop");
    logger.info("main", `utcode starting (dev=${isDev})`);
    settingsStore.load();
    applyTheme();

    // Serve workspace files over the isolated, fetch-friendly preview scheme.
    // CRITICAL: register on EVERY session that can navigate to it — the default
    // session AND the preview webview's partition. protocol.handle() on the
    // default session alone does NOT cover partitioned sessions; an unhandled
    // scheme there is handed off by Chromium to the Windows shell, which shows
    // "You'll need a new app to open this utcode-preview link".
    session.defaultSession.protocol.handle("utcode-preview", handlePreviewRequest);
    session.fromPartition(PREVIEW_PARTITION).protocol.handle("utcode-preview", handlePreviewRequest);
    // Relaxed CSP for preview content ONLY; the main app window keeps its strict CSP.
    session.defaultSession.webRequest.onHeadersReceived({ urls: ["utcode-preview://*/*"] }, (details, callback) => {
      const headers: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(details.responseHeaders ?? {})) {
        if (k.toLowerCase() === "content-security-policy") continue;
        headers[k] = Array.isArray(v) ? v : [String(v)];
      }
      headers["Content-Security-Policy"] = [PREVIEW_CSP];
      callback({ responseHeaders: headers });
    });

    registerIpcHandlers();

    // Restore the last workspace so the window opens ready-to-work.
    try {
      const last = persistentStore.get("lastWorkspace");
      if (last && fsSync.existsSync(last) && fsSync.statSync(last).isDirectory()) {
        workspaceService.open(last, false);
        terminalService.registerWorkspaceCwd(last);
        logger.info("main", `restored last workspace: ${last}`);
      }
    } catch (err) {
      logger.warn("main", `workspace restore failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    createWindow();

    mcpManager.load();
    void mcpManager.connectAllEnabled().catch(() => undefined);

    if (process.env.UTCODE_SMOKE === "1" && mainWindow) {
      const win = mainWindow;
      win.webContents.once("did-finish-load", () => {
        logger.info("smoke", "renderer loaded");
        setTimeout(() => {
          void runSelfTests(win).catch((err: unknown) => {
            logger.error("smoke", `self tests crashed: ${err instanceof Error ? err.message : String(err)}`);
            app.exit(4);
          });
        }, 1500);
      });
      win.webContents.on("render-process-gone", (_e, details) => {
        logger.error("smoke", `renderer gone: ${JSON.stringify(details)}`);
        app.exit(2);
      });
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", (event) => {
    if (!(app as unknown as { __utcodeCleanupsDone?: boolean }).__utcodeCleanupsDone) {
      event.preventDefault();
      (app as unknown as { __utcodeCleanupsDone?: boolean }).__utcodeCleanupsDone = true;
      void shutdown().finally(() => app.quit());
    }
  });
}
