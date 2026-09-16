
# utcode

**utcode** is a local-first AI coding assistant for Windows 10/11. Open a coding
workspace, connect your own AI provider (cloud or fully local), and hand the
agent an autonomous task. A single tool-calling agent inspects your files,
searches the project, edits code, runs terminal commands, understands imports,
uses MCP tools and keeps reasoning until the task is done.

- One reliable autonomous agent (no multi-agent chaos, no hidden chain-of-thought in the UI — you see concise status, tool activity and results)
- Bring your own provider — no subscription, no bundled keys
- Searchable, scrollable, favorite-able model pickers in Settings → Providers
  (every model returned by **Fetch models** is reachable — no clipped lists)
- Secure by design: `contextIsolation`, sandboxed preload, typed IPC, workspace-confinement for all file tools
- Monaco editor with diff review + revert, integrated terminal, safe sandboxed HTML preview
- MCP (Model Context Protocol) stdio servers appear to the agent as ordinary tools
- Chat history, provider settings and agent limits persist between launches

## Requirements

| Item | Version |
| --- | --- |
| OS | Windows 10 / 11 (x64) |
| Node.js | 20.10+ (tested on 22 / 24) |
| Package manager | npm 10+ |

## Development

```powershell
npm install        # install dependencies
npm run dev        # Vite dev server + Electron with hot renderer reload
npm test           # vitest unit/integration tests
npm run typecheck  # strict TS across renderer + main process
npm run build      # production bundle (dist/ + dist-electron/)
npm start          # build then run the packaged-style app locally
```

## Provider setup

Open **Settings → Providers** (or complete the first-run wizard) and add a
provider. You configure `Base URL`, `API key` and `Model` — nothing is
hardcoded and keys never leave the main process: they are encrypted with the
Windows credential store (`safeStorage`) inside your user profile
(`%APPDATA%/utcode/secrets.json` holds only ciphertext), and they are never
sent to the renderer or written to logs.

Supported out of the box:

- **OpenAI** (`openai` type)
- **Anthropic** (`anthropic` type)
- **Google Gemini** (`gemini` type)
- **OpenAI-compatible endpoints**: OpenRouter, Groq, Together, DeepSeek,
  Ollama, LM Studio or any custom `/v1`-style API (`openai-compatible` type
  + your base URL)

Every provider is normalized into one internal format (messages, streaming
text deltas, tool calls with `callId`/`toolName`/`arguments`, tool results),
so the agent engine is provider-agnostic. Use **Test connection** to check a
key/endpoint and see latency.

### Ollama / local models (no cloud at all)

1. Install and start [Ollama](https://ollama.com), pull a tool-calling-capable
   model, e.g. `ollama pull qwen2.5-coder:32b`.
2. Settings → Providers → add **Ollama (local)**. Base URL
   `http://localhost:11434/v1`, model `qwen2.5-coder:32b`, API key can be
   anything/empty.
3. LM Studio works the same with base URL `http://localhost:1234/v1`
   (enable the local server in LM Studio).

## Multi-threaded agent workspaces (Ghost Mode)

Run up to **3 independent agent tasks simultaneously** — e.g. "Refactor the API"
in one tab and "Write DB tests" in another:

- **Parallel** button (chat header) or the Layers button in the sidebar Chats
  section spawns a new task tab. Each has isolated message history, context and
  tool state; a tab bar shows all active conversations with running dots.
- **Workspace Lock:** the first task that edits a file owns it until it finishes;
  any other task trying `write_file`/`patch_file` on that path gets a clear,
  recoverable error instead of corrupting either change.
- **Merge:** when two tasks have changed files, the chat header shows
  **Merge…** — a per-file diff comparison where you Take A / Take B, including
  files both tasks edited.
- The StatusBar shows **N Agents Running**; Stop / Esc only affects the current
  chat's task.

## Local vector index & semantic search (RAG)

`src/main/agent/vectorStore.ts` keeps long-term memory of the codebase:

- On workspace open (and via **Settings → Vector → Index workspace** / the
  Workspace-tab button) files are chunked and embedded into
  `<workspace>/.utcode/vectors.json`. Indexing is incremental (mtime), capped,
  and its progress shows live in the StatusBar.
- Embeddings use a local **Ollama** model (e.g. `nomic-embed-text`) or any
  OpenAI-compatible `/embeddings` endpoint configured in Settings → Vector —
  your code never leaves the machine when using Ollama.
- With **no embedding provider configured**, utcode automatically uses a
  built-in hashed-lexical embedding model — semantic_search still works, fully
  offline, it just matches vocabulary instead of true embeddings.
- The agent gains a `semantic_search(query, top_k)` tool and the system prompt
  tells it to locate code by meaning first instead of walking the file tree.

> Implementation note: the spec suggested `chromadb`/`lancedb`. Those require
> native/server binaries that break portable Windows packaging and offline
> installs in this environment, so — per the project's "closest stable
> supported implementation" rule — the vector store is a dependency-free
> embedded engine with the same capabilities (chunking, embeddings, cosine
> search, persistence) and pluggable real embedding backends.

## Agent Checkpoints & Time Machine

Every `write_file` / `patch_file` the agent performs is checkpointed
(`src/main/fileSystem/snapshotManager.ts`):

- Before the tool runs, the **previous file content** and the **exact agent
  message context** are captured (an audit copy is also written to
  `<workspace>/.utcode/snapshots/`, which the file tree/search ignore).
- Every file-changing card in the chat gets two actions:
  - **Restore to this point** — reverts all file changes made at/after that
    step (files that didn't exist yet are deleted).
  - **Restore & re-run** — additionally rewinds the agent's context to that
    moment and re-runs the same task from there with a fresh model decision.
- **Rollback all** (chat header) undoes the whole agent session's file
  changes back to the state when the run started.
- The **StatusBar** shows the `⏱ N` checkpoint badge = how many steps back
  you can currently go; each card also exposes its own rewind.
- Checkpoints live in memory for the current app session (files + timeline
  survive restarts, rewind targets do not).

## Intelligent Model Router

Instead of one static model, the agent classifies **every task** before calling a
provider and routes it to the best tier (`src/main/agent/modelRouter.ts`):

| Tier | For | Examples |
| --- | --- | --- |
| **1 · Fast/Cheap** | reads, searches, renames, tiny edits | Ollama local, gpt-4o-mini, Haiku |
| **2 · Balanced** | multi-file features, regular refactors | Sonnet, GPT-4o |
| **3 · Heavy Reasoning** | architecture, nasty bugs, migrations | o1, Opus |

- Heuristic scoring uses task length, file-reference count, and complexity
  keywords — deterministic and test-covered.
- Assign a provider (and optional model override + $/1M pricing) per tier in
  **Settings → Router**. Unassigned tiers fall back to your default provider.
- Manual override: the **Auto-route chip** in the composer pins a tier for
  subsequent tasks; **Auto** re-enables classification. The chip also has an
  **on/off switch** — with the router off, every task goes straight to your
  default provider, exactly like a static setup.
- The chat timeline shows the decision, e.g. `Using Tier 2 (Balanced) —
  moderate edits … → OpenAI · gpt-4o`.
- The status bar tracks **session tokens + estimated cost** (real usage when
  the provider reports it, ≈ chars/4 otherwise).

## MCP servers

MCP servers extend the agent with external tools. Configure them in
**Settings → MCP** (persisted as `mcp_config.json` in
`%APPDATA%/utcode`, or a custom path). Example:

```json
{
  "servers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    }
  }
}
```

- Only `stdio` servers run on your machine are executed — starting a server is
  always your explicit configuration (consent), never silent.
- Discovered tools are namespaced `mcp.<server>.<tool>` and flow through the
  same internal tool abstraction as native tools.
- Connect/disconnect/inspect tools live from the UI; a server that dies during
  a task returns a structured tool error and the agent continues.

## Terminal & filesystem safety

- All file tools are confined to the opened workspace; `../` traversal,
  absolute escapes and null bytes are rejected.
- `patch_file` demands an exact, unique search block and reports a `+x/-y`
  line summary; ambiguous or missing matches fail with actionable errors.
- Terminal commands run only inside the workspace directory, with timeout,
  output caps, streaming to the UI and cancellation (also from agent stop).
- Editor conflicts: if you have unsaved edits and the agent changes the same
  file, utcode flags a conflict instead of destroying your work.

## Windows packaging

```powershell
npm run dist:win
```

Produces in `release/`:

- `utcode-Setup-<version>.exe` — NSIS installer (per-user, install dir
  selectable)
- `utcode-portable-<version>.exe` — portable single-file build

## Using your own logo

1. Save your logo as **`buildResources/logo.png`** — square PNG, any size
   (transparent background looks best).
2. Resize it into the icon pipeline and regenerate (both run offline from the repo):
   ```powershell
   # one-time resize (e.g. a 1024px source) to 256x256, via Electron's image engine
   $env:UTCODE_LOGO_IN="C:\path\to\my-logo.png"; $env:UTCODE_LOGO_OUT="buildResources\logo.png"
   npx electron scripts/resize-logo.mjs
   node scripts/make-icon.mjs
   ```
   It writes `buildResources/icon.ico` (installer icon) and `buildResources/icon.png`
   (window/taskbar icon). `npm run dist` / `dist:win` run `make-icon.mjs` for you.
3. Rebuild (`npm run dist:win`) — the packaged `resources/icon.png` is verified to
   match your logo, and the packaged app passes its self-tests.

Delete `logo.png` (or never add it) and the generator keeps drawing the built-in placeholder.

The packaged app loads the renderer from `dist/` inside the asar, runs the
main process from `dist-electron/main.mjs`, and reads user configuration
securely from `%APPDATA%/utcode`. Code signing can be configured via electron-builder
environment variables (`CSC_LINK`, `CSC_KEY_PASSWORD`).

> Note: `win.signAndEditExecutable` is set to `false` so unsigned local builds
> work on machines without symlink privileges (standard Windows user). Enable
> it (and Windows Developer Mode or an admin shell, plus signing env vars)
> when you want the icon/version resource embedded in `utcode.exe`.

## Project layout

```text
src/
├── main/                 # Electron main process
│   ├── main.ts           # window, security, lifecycle, smoke self-tests
│   ├── preload.ts        # typed contextBridge API (sandboxed, CJS)
│   ├── ipcHandlers.ts    # all IPC, unified {success,data,error} envelope
│   ├── agent/            # single-agent loop, model router, context manager, system prompt
│   ├── providers/        # OpenAI / Anthropic / Gemini / compatible adapters
│   ├── tools/            # tool registry, validation, native coding tools
│   ├── fileSystem/       # import & dependency scanner
│   ├── mcp/              # MCP client manager + tool adapter
│   ├── workspace/        # workspace service + path security
│   ├── terminal/         # safe command runner (stream/timeout/cancel)
│   └── services/         # settings store, chat store, secure keys, logger
├── renderer/             # React UI (Vite + Tailwind + Zustand + Monaco)
└── shared/               # types, IPC contracts, constants
```

## Preview, themes & dashboard notes

- **Preview tab** runs in an Electron **`<webview>` in its own isolated process**,
  served through a custom `utcode-preview://` origin rooted at your workspace —
  real CSS, JavaScript, **WebGL** (Three.js / Babylon), `fetch()` / dynamic-import
  asset loading (`.png`, `.json`, `.wasm`, `.glb`) and relative paths all work.
  A preview crash never takes the app down: you get a "Preview crashed" card with
  the last errors and a Reload button. A **Preview Console** pipes the page's
  `console.log/warn/error` + `window.onerror` into the tab; the view auto-reloads
  (500 ms debounce) when you or the agent save files. CSP is relaxed **only** for
  preview pages (shader compilation needs `unsafe-eval`); the app keeps strict CSP.
  **Low Memory Mode** (Settings → Appearance, restart to apply) still renders
  WebGL previews, just slower.
  `utcode-preview://` is handled **internally only** — registered on the default
  session and the preview partition session via `session.protocol.handle`, never
  with `setAsDefaultProtocolClient` or registry entries — so Windows never gets
  a chance to show "You'll need a new app to open this link". `openExternal`
  additionally refuses every non-`http/https/mailto` URL as a second guard.
- **Themes**: Settings → Appearance offers Warm Dark (default), OLED Black,
  Dracula, Nord, Solarized Dark, Light and **Custom** (pick background, panel,
  text and accent — everything else is derived). Themes are CSS variables
  (`--c-bg`, `--c-accent`, …) applied live; the editor and window title bar
  follow the scheme.
- **Dashboard**: launches with the "What's up next?" stats screen (real
  sessions/messages/token/heatmap data from your chat history). It is replaced
  by the chat as soon as a conversation has messages; the composer's
  **ctx bar** shows live context-window usage (green/yellow/red).
- **Micro-polish**: chat auto-scrolls only when you're at the bottom and offers a
  "Jump to bottom" pill otherwise; every code block has a hover **Copy** button
  (with "Copied!" toast); the StatusBar shows `Tokens: used / capacity` with a
  colored meter and a USD-cost tooltip (edit prices in Settings → Agent, or per
  tier in Model Router); the heatmap squares grow on hover with date tooltips.
- **Responsive**: below 1000 px the explorer auto-collapses into an icon rail;
  all columns keep min-widths so nothing squishes, and splitters resize both
  side panels (double-click resets).

## Layout & sidebar

- The explorer **sidebar is hidden by default**; toggle it with the PanelLeft
  button in the header (or `Ctrl+B`). It animates open to a compact 240 px
  column (drag the splitter to resize 220–300 px; double-click resets).
- Below 1000 px width the sidebar becomes a floating overlay above the chat
  and a thin icon rail stands in when closed — columns never squish each other:
  chat keeps a 360 px floor and the workspace panel a 350 px floor, with the
  panel width auto-clamped to the window so the terminal can't get cut off.
- **Settings lives in exactly one place:** the full-width row at the bottom of
  the sidebar (`Ctrl+,` also opens it). No scattered gears anywhere else.

- **Custom title bar:** frameless window with a dark in-app `TitleBar` (drag region +
  brand + workspace + version) and native Windows min/max/close overlay controls tinted
  to the theme (`titleBarOverlay`). Closing the last window quits (macOS re-opens on dock click).

- Editor tabs stay in sync: agent edits, external saves and disk changes (an
  `fs.watch` on the workspace with 300 ms debounce) refresh the file tree live —
  new files appear instantly and fade-highlight — including files created by
  terminal commands; the containing folders auto-expand.
- **Live file tree**: the sidebar explorer and workspace refresh automatically
  when files are created, changed or deleted — by the agent, the terminal or
  any outside editor. No restart needed.
- **No token counters in the UI**: pricing is tracked internally for context
  safety only (graceful 90% wrap-up); the StatusBar shows model, running state
  and indexed-file count instead.

## About tab links

The Settings → About links (GitHub / Report a Bug / Check for Updates) point at
`GITHUB_REPO` in `src/shared/constants.ts` — set it to your own `owner/name`
repo before shipping, or the release checker will find nothing.

## Large files & diagnostics
- **Chunked streaming**: files over the editor cap (1 MB default preview) are no
  longer a problem — open up to **8 MB** logs/JSON/bundles and utcode streams the
  full text into Monaco in 1 MB chunks with a live progress bar; anything beyond
  8 MB shows the first part with an honest banner. Streams are capped,
  cancellable (tab close) and hard-aborted on workspace switch.
- **Diagnostics**: Settings → About → *Diagnostics* shows runtime versions
  (Electron/Node/Chromium), workspace, watcher/index state, active model and the
  last log warnings — with Copy-all and *Reveal log in Explorer*. Paths are
  confined to utcode's own `%APPDATA%` data for safety.
- **File tree live refresh (3 layers)**: agent writes stamp `create/modify`
  events, terminal commands trigger a tree refresh when they finish, and an
  `fs.watch` recursive watcher (300 ms debounce, `node_modules`/`.git`/`dist`/
  `.cache` ignored, create/modify/delete classified) catches everything else —
  the affected folder auto-expands and new files fade-highlight, no restart.

## State persistence (v0.1.1)

- **Window bounds** are saved on move/resize (debounced) and restored on next
  launch (validated against connected displays, so unplugging a monitor can
  never strand the window off-screen); maximized state is remembered too.
- **Last workspace** is auto-reopened on startup (if the folder still exists),
  so utcode opens ready-to-work.
- **Per-chat memory**: every chat records the workspace it belongs to plus the
  editor tabs that were open. Clicking a chat restores it fully — switching
  workspaces automatically, refetching the file tree, reopening that chat's
  tabs (your unsaved edits in other chats' tabs are never discarded) and
  scrolling to its last message.
- **New task with no workspace** → the folder picker opens *first*; cancel and
  no stray chat is created.
- **Recent models**: the composer's model dropdown keeps your last 5 picks at
  the top (persisted), and each chat stores its accumulated token total.
- Persistence lives in `%APPDATA%\utcode` (`settings.json`, `chats.json`,
  `utcode-state.json`, encrypted `secrets.json`).

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+Enter` / `Enter` | Send task (in composer) |
| `Esc` | Stop the running agent |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+J` | Toggle workspace panel (chat-focused mode) |
| `` Ctrl+` `` | Focus terminal tab |
| `Ctrl+S` | Save active file |
| `Ctrl+,` | Open settings |

## Notes

- Agent loop protection: max iterations, per-tool output truncation, repeated
  identical-call detection, context budget compaction.
- Logs are structured and secret-redacted (`%APPDATA%/utcode/utcode.log`).
- Chat history persists via a JSON store abstraction that can later migrate to
  SQLite without touching UI code.
