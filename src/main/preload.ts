import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC } from "../shared/ipc";
import type { UtcodeApi } from "../shared/ipc";
import type {
  AgentEvent,
  AppSettings,
  Chat,
  McpServerConfig,
  PatchRequest,
  PreviewConsoleLine,
  ProviderInput,
  TerminalOutputChunk
} from "../shared/types";

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: UtcodeApi = {
  appInfo: () => invoke(IPC.appInfo),
  appLatestRelease: () => invoke(IPC.appLatestRelease),

  workspaceOpen: () => invoke(IPC.workspaceOpen),
  workspaceChooseDirectory: () => invoke(IPC.workspaceChooseDirectory),
  workspaceOpenPath: (root: string, remember?: boolean) => invoke(IPC.workspaceOpenPath, root, remember !== false),
  workspaceGet: () => invoke(IPC.workspaceGet),
  workspaceList: (dir: string) => invoke(IPC.workspaceList, dir),
  readFile: (p: string) => invoke(IPC.workspaceReadFile, p),
  writeFile: (p: string, content: string) => invoke(IPC.workspaceWriteFile, p, content),
  patchFile: (req: PatchRequest) => invoke(IPC.workspacePatchFile, req),
  search: (query: string, opts) => invoke(IPC.workspaceSearch, query, opts),
  scanImports: (p: string) => invoke(IPC.workspaceScanImports, p),

  terminalRun: (command: string, cwd?: string) => invoke(IPC.terminalRun, command, cwd),
  terminalCancel: (id: string) => invoke(IPC.terminalCancel, id),
  terminalStatus: (id: string) => invoke(IPC.terminalStatus, id),
  onTerminalStream: (cb: (chunk: TerminalOutputChunk) => void) => subscribe(IPC.terminalStream, cb),

  agentRun: (task: string, chatId: string) => invoke(IPC.agentRun, task, chatId),
  agentCancel: (runId?: string | null) => invoke(IPC.agentCancel, runId ?? null),
  agentRestore: (runId: string, callId: string, resume: boolean) => invoke(IPC.agentRestore, runId, callId, resume),
  agentRunning: () => invoke(IPC.agentRunning),
  mergeList: (runA: string, runB: string) => invoke(IPC.mergeList, runA, runB),
  mergeApply: (runId: string, path: string) => invoke(IPC.mergeApply, runId, path),
  vectorIndex: (rebuild: boolean) => invoke(IPC.vectorIndex, rebuild),
  vectorStatus: () => invoke(IPC.vectorStatus),
  onAgentEvent: (cb: (event: AgentEvent) => void) => subscribe(IPC.agentEvent, cb),

  onPreviewConsole: (cb: (line: PreviewConsoleLine) => void) => subscribe<PreviewConsoleLine>(IPC.previewConsole, cb),
  onPreviewCrashed: (cb: (info: { reason: string }) => void) => subscribe<{ reason: string }>(IPC.previewCrashed, cb),

  providerList: () => invoke(IPC.providerList),
  providerSave: (provider: ProviderInput) => invoke(IPC.providerSave, provider),
  providerDelete: (id: string) => invoke(IPC.providerDelete, id),
  providerTest: (id: string) => invoke(IPC.providerTest, id),
  providerFetchModels: (id: string) => invoke(IPC.providerFetchModels, id),
  providerSetDefault: (id: string | null) => invoke(IPC.providerSetDefault, id),

  mcpList: () => invoke(IPC.mcpList),
  mcpSave: (server: McpServerConfig) => invoke(IPC.mcpSave, server),
  mcpDelete: (name: string) => invoke(IPC.mcpDelete, name),
  mcpConnect: (name: string) => invoke(IPC.mcpConnect, name),
  mcpDisconnect: (name: string) => invoke(IPC.mcpDisconnect, name),
  mcpTools: (name: string) => invoke(IPC.mcpTools, name),
  mcpImport: () => invoke(IPC.mcpImport),

  settingsGet: () => invoke(IPC.settingsGet),
  settingsSave: (patch: Partial<AppSettings>) => invoke(IPC.settingsSave, patch),

  chatList: () => invoke(IPC.chatList),
  chatSave: (chat: Chat) => invoke(IPC.chatSave, chat),
  chatDelete: (id: string) => invoke(IPC.chatDelete, id),

  openExternal: (url: string) => invoke(IPC.uiOpenExternal, url),
  openFileDialog: () => invoke(IPC.uiOpenFileDialog),
  saveFileDialog: (name: string) => invoke(IPC.uiSaveFileDialog, name),
  revealPath: (p: string) => invoke(IPC.uiRevealPath, p),
  appDiagnostics: () => invoke(IPC.appDiagnostics),
  fileReadStreamStart: (p: string) => invoke(IPC.fileReadStream, p),
  fileStreamAbort: (id: string) => invoke(IPC.fileStreamAbort, id),
  onFileStreamChunk: (cb: (evt: import("../shared/types").FileStreamChunkEvent) => void) =>
    subscribe<import("../shared/types").FileStreamChunkEvent>(IPC.fileStreamChunk, cb),
  storeGet: (key: import("../shared/types").PersistKey) => invoke(IPC.storeGet, key),
  storeSet: (key: import("../shared/types").PersistKey, value: unknown) => invoke(IPC.storeSet, key, value),
  storeRememberModel: (providerId: string, model: string) => invoke(IPC.storeRememberModel, providerId, model)
};

contextBridge.exposeInMainWorld("utcode", api);
