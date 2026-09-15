import type {
  AgentEvent,
  AppSettings,
  Chat,
  DialogOpenFileResult,
  AppDiagnostics,
  FileStreamChunkEvent,
  PreviewConsoleLine,
  DependencyReport,
  FileContent,
  IpcResult,
  PersistKey,
  RecentModel,
  McpServerConfig,
  McpServerStatus,
  MergeComparison,
  PatchRequest,
  PatchResult,
  ProcessStatus,
  ProviderConfig,
  ProviderInput,
  ProviderTestResult,
  RestoreResult,
  SearchResult,
  TerminalOutputChunk,
  TerminalRunResult,
  VectorStatus,
  WorkspaceFileInfo
} from "./types";

export const IPC = {
  appInfo: "app:info",
  appLatestRelease: "app:latestRelease",
  workspaceOpen: "workspace:open",
  workspaceOpenPath: "workspace:openPath",
  workspaceChooseDirectory: "workspace:chooseDirectory",
  workspaceGet: "workspace:get",
  workspaceList: "workspace:list",
  workspaceReadFile: "workspace:readFile",
  workspaceWriteFile: "workspace:writeFile",
  workspacePatchFile: "workspace:patchFile",
  workspaceSearch: "workspace:search",
  workspaceScanImports: "workspace:scanImports",
  terminalRun: "terminal:run",
  terminalStream: "terminal:stream",
  terminalCancel: "terminal:cancel",
  terminalStatus: "terminal:status",
  agentRun: "agent:run",
  agentCancel: "agent:cancel",
  agentRestore: "agent:restore",
  agentRunning: "agent:running",
  mergeList: "merge:list",
  mergeApply: "merge:apply",
  vectorIndex: "vector:index",
  vectorStatus: "vector:status",
  agentEvent: "agent:event",
  providerList: "provider:list",
  providerSave: "provider:save",
  providerDelete: "provider:delete",
  providerTest: "provider:test",
  providerFetchModels: "provider:fetchModels",
  providerSetDefault: "provider:setDefault",
  mcpList: "mcp:list",
  mcpSave: "mcp:save",
  mcpDelete: "mcp:delete",
  mcpConnect: "mcp:connect",
  mcpDisconnect: "mcp:disconnect",
  mcpTools: "mcp:tools",
  mcpImport: "mcp:import",
  settingsGet: "settings:get",
  settingsSave: "settings:save",
  chatList: "chat:list",
  chatSave: "chat:save",
  chatDelete: "chat:delete",
  uiOpenExternal: "ui:openExternal",
  uiOpenFileDialog: "ui:openFileDialog",
  uiSaveFileDialog: "ui:saveFileDialog",
  uiStateChanged: "ui:state",
  uiRevealPath: "ui:revealPath",
  appDiagnostics: "app:diagnostics",
  fileReadStream: "file:readStream",
  fileStreamAbort: "file:streamAbort",
  fileStreamChunk: "file:streamChunk",
  previewConsole: "preview:console",
  previewCrashed: "preview:crashed",
  storeGet: "store:get",
  storeSet: "store:set",
  storeRememberModel: "store:rememberModel"
} as const;

export interface UtcodeApi {
  appInfo(): Promise<IpcResult<{ version: string; name: string; user: string }>>;
  appLatestRelease(): Promise<IpcResult<string | null>>;

  workspaceOpen(): Promise<IpcResult<string | null>>;
  workspaceChooseDirectory(): Promise<IpcResult<string | null>>;
  workspaceOpenPath(root: string, remember?: boolean): Promise<IpcResult<string | null>>;
  workspaceGet(): Promise<IpcResult<string | null>>;
  workspaceList(dir: string): Promise<IpcResult<WorkspaceFileInfo[]>>;
  readFile(path: string): Promise<IpcResult<FileContent>>;
  writeFile(path: string, content: string): Promise<IpcResult<FileContent>>;
  patchFile(req: PatchRequest): Promise<IpcResult<PatchResult>>;
  search(query: string, opts?: { regex?: boolean; include?: string; maxResults?: number; contextLines?: number }): Promise<IpcResult<SearchResult>>;
  scanImports(path: string): Promise<IpcResult<DependencyReport>>;

  terminalRun(command: string, cwd?: string): Promise<IpcResult<TerminalRunResult>>;
  terminalCancel(id: string): Promise<IpcResult<boolean>>;
  terminalStatus(id: string): Promise<IpcResult<ProcessStatus | null>>;
  onTerminalStream(cb: (chunk: TerminalOutputChunk) => void): () => void;

  agentRun(task: string, chatId: string): Promise<IpcResult<string>>;
  agentCancel(runId?: string | null): Promise<IpcResult<number>>;
  agentRestore(runId: string, callId: string, resume: boolean): Promise<IpcResult<RestoreResult>>;
  agentRunning(): Promise<IpcResult<{ runId: string; chatId: string; startedAt: number }[]>>;
  mergeList(runA: string, runB: string): Promise<IpcResult<MergeComparison>>;
  mergeApply(runId: string, path: string): Promise<IpcResult<boolean>>;
  vectorIndex(rebuild: boolean): Promise<IpcResult<VectorStatus>>;
  vectorStatus(): Promise<IpcResult<VectorStatus>>;
  onAgentEvent(cb: (event: AgentEvent) => void): () => void;

  providerList(): Promise<IpcResult<ProviderConfig[]>>;
  providerSave(provider: ProviderInput): Promise<IpcResult<ProviderConfig>>;
  providerDelete(id: string): Promise<IpcResult<boolean>>;
  providerTest(id: string): Promise<IpcResult<ProviderTestResult>>;
  providerFetchModels(id: string): Promise<IpcResult<string[]>>;
  providerSetDefault(id: string | null): Promise<IpcResult<boolean>>;

  mcpList(): Promise<IpcResult<McpServerStatus[]>>;
  mcpSave(server: McpServerConfig): Promise<IpcResult<McpServerStatus[]>>;
  mcpDelete(name: string): Promise<IpcResult<McpServerStatus[]>>;
  mcpConnect(name: string): Promise<IpcResult<McpServerStatus>>;
  mcpDisconnect(name: string): Promise<IpcResult<McpServerStatus>>;
  mcpTools(name: string): Promise<IpcResult<{ name: string; description: string }[]>>;
  mcpImport(): Promise<IpcResult<McpServerConfig[]>>;

  settingsGet(): Promise<IpcResult<AppSettings>>;
  settingsSave(patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>>;

  chatList(): Promise<IpcResult<Chat[]>>;
  chatSave(chat: Chat): Promise<IpcResult<Chat[]>>;
  chatDelete(id: string): Promise<IpcResult<Chat[]>>;

  openExternal(url: string): Promise<IpcResult<boolean>>;
  openFileDialog(): Promise<IpcResult<DialogOpenFileResult>>;
  saveFileDialog(name: string): Promise<IpcResult<DialogOpenFileResult>>;
  revealPath(p: string): Promise<IpcResult<boolean>>;
  appDiagnostics(): Promise<IpcResult<AppDiagnostics>>;
  fileReadStreamStart(path: string): Promise<IpcResult<{ id: string; size: number }>>;
  fileStreamAbort(id: string): Promise<IpcResult<boolean>>;
  onFileStreamChunk(cb: (evt: FileStreamChunkEvent) => void): () => void;
  onPreviewConsole(cb: (line: PreviewConsoleLine) => void): () => void;
  onPreviewCrashed(cb: (info: { reason: string }) => void): () => void;
  storeGet(key: PersistKey): Promise<IpcResult<unknown>>;
  storeSet(key: PersistKey, value: unknown): Promise<IpcResult<boolean>>;
  storeRememberModel(providerId: string, model: string): Promise<IpcResult<RecentModel[]>>;
}
