import type { AgentSettings, PricingSettings, RouterSettings, VectorSettings } from "./types";

export const APP_NAME = "utcode";
export const APP_VERSION = "0.1.1";
/**
 * Your public GitHub repo as "owner/name". The About tab links (GitHub,
 * Report a Bug, Check for Updates) point here — change it to YOUR repo.
 */
export const GITHUB_REPO = "utcode/utcode";

export const WINDOW_MIN_WIDTH = 900;
export const WINDOW_MIN_HEIGHT = 600;
export const WINDOW_DEFAULT_WIDTH = 1440;
export const WINDOW_DEFAULT_HEIGHT = 900;
export const BACKGROUND_COLOR = "#1e1e1e";
/** Electron-internal webview session for previews. The utcode-preview:// scheme
 *  is handled ONLY inside these Electron sessions — never registered with the OS. */
export const PREVIEW_PARTITION = "persist:utcode-preview";

export const SETTINGS_FILE = "settings.json";
export const CHATS_FILE = "chats.json";
export const MCP_CONFIG_FILE = "mcp_config.json";
export const LOG_FILE = "utcode.log";

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  maxIterations: 40,
  maxOutputPerTool: 28000,
  maxFileSizeBytes: 1024 * 1024,
  maxSearchResults: 80,
  maxContextChars: 260000,
  commandTimeoutMs: 120000,
  temperature: 0.2,
  maxTokens: 8192,
  autoImportScan: true
};

export const DEFAULT_ROUTER: RouterSettings = {
  mode: "auto",
  tiers: {
    1: { providerId: null, model: "", priceInUsd: 0, priceOutUsd: 0 },
    2: { providerId: null, model: "", priceInUsd: 3, priceOutUsd: 15 },
    3: { providerId: null, model: "", priceInUsd: 15, priceOutUsd: 60 }
  }
};

export const DEFAULT_VECTOR: VectorSettings = {
  enabled: true,
  providerId: null,
  model: "nomic-embed-text"
};

export const MAX_PARALLEL_AGENTS = 3;
export const VECTOR_MAX_FILES = 1500;
export const VECTOR_MAX_FILE_BYTES = 262144;

export const IGNORED_DIRECTORIES = [
  "node_modules",
  ".utcode",
  ".git",
  "dist",
  "build",
  ".cache",
  "out",
  "release",
  "coverage",
  ".next",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  "vendor",
  "target"
];

export const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".avif",
  ".pdf", ".zip", ".gz", ".7z", ".rar", ".tar", ".bz2", ".xz",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".obj", ".o", ".a", ".lib",
  ".mp3", ".mp4", ".avi", ".mov", ".wmv", ".wav", ".ogg", ".webm",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".pyc", ".class", ".jar", ".war", ".pdb"
]);

export const DEFAULT_PRICING: PricingSettings = { inUsdPerM: 3, outUsdPerM: 15 };

export const MAX_RECENT_WORKSPACES = 8;
export const MAX_CHATS_PERSISTED = 50;
export const MAX_TERMINAL_OUTPUT_CHARS = 200000;
export const MAX_TREE_ENTRIES = 400;
