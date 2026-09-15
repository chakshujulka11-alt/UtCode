export interface IpcResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string;
}

export interface WorkspaceFileInfo {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

export interface WorkspaceFileNode extends WorkspaceFileInfo {
  children?: WorkspaceFileNode[];
}

export interface FileContent {
  path: string;
  content: string;
  encoding: "utf-8" | "binary";
  size: number;
  modifiedAt: number;
  truncated: boolean;
  language?: string;
}

export interface PatchRequest {
  path: string;
  search: string;
  replace: string;
  replaceAll?: boolean;
}

export interface PatchResult {
  path: string;
  applied: boolean;
  replacements: number;
  linesAdded: number;
  linesRemoved: number;
  before: string;
  after: string;
  summary: string;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
  context: string[];
}

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
  totalFilesScanned: number;
}

export interface TerminalExecution {
  id: string;
  command: string;
  cwd: string;
  /** agent run that spawned this command, for per-run cancellation */
  runId?: string;
}

export interface TerminalRunResult {
  id: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
}

export interface TerminalOutputChunk {
  id: string;
  stream: "stdout" | "stderr" | "system";
  data: string;
}

export interface ProcessStatus {
  id: string;
  running: boolean;
  command: string;
  startedAt: number;
}

export type ProviderType =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openai-compatible";

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  model: string;
  baseUrl?: string;
  enabled: boolean;
  apiKeyPresent?: boolean;
  apiKeyMasked?: string;
  availableModels?: string[];
}

export interface ProviderInput extends Omit<ProviderConfig, "apiKeyPresent" | "apiKeyMasked"> {
  apiKey?: string;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs?: number;
  models?: string[];
  error?: string;
  technical?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentSettings {
  maxIterations: number;
  maxOutputPerTool: number;
  maxFileSizeBytes: number;
  maxSearchResults: number;
  maxContextChars: number;
  commandTimeoutMs: number;
  temperature: number;
  maxTokens: number;
  autoImportScan: boolean;
}

export type ThemeId =
  | "warm-dark"
  | "oled"
  | "dracula"
  | "nord"
  | "solarized"
  | "light"
  | "custom"
  | "dark"
  | "system";

export interface CustomThemeColors {
  bg: string;
  panel: string;
  text: string;
  accent: string;
}

export interface UiSettings {
  theme: ThemeId;
  custom?: CustomThemeColors;
  displayName?: string;
  sidebarWidth?: number;
  workspaceWidth?: number;
  lowMemoryMode?: boolean;
}

export type RouterTier = 1 | 2 | 3;
export type RouterMode = "off" | "auto" | "tier1" | "tier2" | "tier3";

export interface RouterTierConfig {
  providerId: string | null;
  model: string;
  priceInUsd: number;
  priceOutUsd: number;
}

export interface RouterSettings {
  mode: RouterMode;
  tiers: Record<RouterTier, RouterTierConfig>;
}

export interface VectorSettings {
  enabled: boolean;
  providerId: string | null;
  model: string;
}

export interface VectorStatus {
  files: number;
  chunks: number;
  backend: string;
  lastIndexedAt: number | null;
}

export interface MergeFileEntry {
  path: string;
  before: string | null;
  after: string | null;
  edits: number;
}

export interface MergeComparison {
  files: {
    path: string;
    a: MergeFileEntry | null;
    b: MergeFileEntry | null;
  }[];
}

export interface PricingSettings {
  inUsdPerM: number;
  outUsdPerM: number;
}

export interface AppSettings {
  version: number;
  defaultProviderId: string | null;
  activeProviderId: string | null;
  providers: ProviderConfig[];
  agent: AgentSettings;
  ui: UiSettings;
  recentWorkspaces: string[];
  mcpConfigPath: string | null;
  router: RouterSettings;
  vector: VectorSettings;
  pricing: PricingSettings;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  disabled?: boolean;
}

export type McpStatus = "stopped" | "connecting" | "connected" | "error";

export interface McpServerStatus {
  name: string;
  status: McpStatus;
  toolCount: number;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolEvents?: AgentEvent[];
  createdAt: number;
  streaming?: boolean;
  status?: "ok" | "error" | "cancelled";
  meta?: string;
}

export interface Chat {
  id: string;
  title: string;
  /** workspace this chat belongs to (spec: workspacePath) */
  workspaceRoot: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  usage?: ChatUsage;
  checkpointRunId?: string;
  checkpointCount?: number;
  /** editor tabs that were open when this chat was last active */
  openFiles?: string[];
  /** file that was focused in the editor when this chat was last active */
  activeFile?: string | null;
  /** accumulated prompt+completion tokens for this chat */
  totalTokens?: number;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model?: string;
  contextPct?: number;
  estimated?: boolean;
}

export interface RestoreResult {
  restoredFiles: string[];
  remainingCheckpoints: number;
  resumed: boolean;
  newRunId?: string;
}

export type AgentEventKind =
  | "agent_started"
  | "thinking"
  | "text_delta"
  | "tool_started"
  | "tool_result"
  | "file_changed"
  | "terminal_output"
  | "terminal_finished"
  | "error"
  | "agent_finished"
  | "mcp_event"
  | "usage"
  | "checkpoint"
  | "index"
  | "state";

export interface AgentEvent {
  kind: AgentEventKind;
  runId: string;
  chatId?: string;
  timestamp: number;
  text?: string;
  toolName?: string;
  callId?: string;
  args?: Record<string, unknown>;
  target?: string;
  result?: string;
  ok?: boolean;
  durationMs?: number;
  path?: string;
  before?: string;
  after?: string;
  summary?: string;
  chunk?: TerminalOutputChunk;
  status?: string;
  tier?: RouterTier;
  model?: string;
  remaining?: number;
  done?: number;
  total?: number;
  contextPct?: number;
  estimated?: boolean;
  operation?: "create" | "modify" | "delete";
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}

export interface ImportedDependency {
  specifier: string;
  resolvedPath: string | null;
  exports: string[];
}

export interface DependencyReport {
  file: string;
  imports: ImportedDependency[];
  importedBy: string[];
  exports: string[];
}

export interface DialogOpenFileResult {
  canceled: boolean;
  path?: string;
}

export interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

export interface RecentModel {
  providerId: string;
  model: string;
}

export type PersistKey = "windowBounds" | "recentModels" | "lastWorkspace" | "favorites";

export interface FileStreamChunkEvent {
  id: string;
  chunk?: string;
  progress: number;
  done: boolean;
  error?: string;
}

export interface AppDiagnostics {
  appVersion: string;
  electron: string;
  node: string;
  chromium: string;
  v8: string;
  platform: string;
  arch: string;
  userDataPath: string;
  logPath: string;
  workspace: string | null;
  runningAgents: number;
  watcherActive: boolean;
  vectorFiles: number;
  vectorChunks: number;
  vectorBackend: string;
  providerCount: number;
  activeProvider: string | null;
  lastErrors: string[];
}

export type PreviewLogLevel = "log" | "info" | "warning" | "error";

export interface PreviewConsoleLine {
  level: PreviewLogLevel;
  message: string;
  source?: string;
  line?: number;
  at: number;
}
