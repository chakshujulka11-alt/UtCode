import { randomUUID } from "node:crypto";
import type { AgentTool, ToolResult } from "./toolTypes";
import { workspaceService } from "../workspace/workspaceService";
import { terminalService } from "../terminal/terminalService";
import { scanImports } from "../fileSystem/importScanner";
import { snapshotManager } from "../fileSystem/snapshotManager";
import { settingsStore } from "../services/settingsStore";
import { workspaceLocks } from "../agent/workspaceLocks";
import { vectorStore, type EmbeddingConfig } from "../agent/vectorStore";
import { extractLineDiff } from "./textDiff";
import { resolveWorkspacePath, toWorkspaceRelative } from "../workspace/pathSecurity";

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { ok: true, content, metadata };
}

function fail(message: string): ToolResult {
  return { ok: false, content: `Error: ${message}` };
}

function asString(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? (args[key] as string) : "";
}

function asNumber(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asBoolean(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

export function createNativeTools(): AgentTool[] {
  return [listDirectoryTool, readFileTool, writeFileTool, patchFileTool, terminalTool, searchTool, scanImportsTool, semanticSearchTool];
}

export function embeddingConfig(): EmbeddingConfig | null {
  const s = settingsStore.get();
  if (!s.vector?.enabled) return null;
  const all = settingsStore.getPublicProviders();
  const p =
    (s.vector.providerId ? all.find((x) => x.id === s.vector.providerId && x.enabled) : null) ??
    all.find((x) => x.id === (s.activeProviderId ?? s.defaultProviderId) && x.enabled) ??
    all.find((x) => x.enabled);
  if (!p) return null;
  const baseUrl = (p.baseUrl ?? "").trim() || (p.type === "openai" ? "https://api.openai.com/v1" : "");
  if (!baseUrl) return null;
  const apiKey = settingsStore.getApiKey(p.id);
  if (!apiKey && !/localhost|127\.0\.0\.1/.test(baseUrl)) return null;
  return { baseUrl, apiKey, model: s.vector.model?.trim() || p.model };
}

function lockCheck(paths: string[], runId: string): ToolResult | null {
  const res = workspaceLocks.acquire(paths, runId);
  if (res.ok) return null;
  const list = res.conflicts.map((c) => `"${c.path}" (held by task ${c.owner.slice(0, 8)}…)`).join(", ");
  return fail(
    `Workspace lock: ${list} is currently being edited by another running agent task. Do not fight over it — continue with files nobody holds, or finish independent work first, then retry.`
  );
}

const listDirectoryTool: AgentTool = {
  source: "native",
  name: "list_directory",
  description:
    "List entries of a directory inside the workspace. Returns name, path, type and size. Prefer shallow listings; pass recursive only when needed with a small depth.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Workspace-relative directory path. Use "." for the workspace root.' },
      recursive: { type: "boolean", description: "Recurse into subdirectories (default false)." },
      maxDepth: { type: "number", description: "Maximum recursion depth when recursive=true (max 3, default 1)." }
    },
    required: ["path"]
  },
  async execute(args, ctx): Promise<ToolResult> {
    const dir = asString(args, "path") || ".";
    const recursive = asBoolean(args, "recursive");
    const maxDepth = Math.min(Math.max(1, asNumber(args, "maxDepth", 1)), 3);
    const collected: string[] = [];
    let truncated = false;
    const visit = async (rel: string, depth: number): Promise<void> => {
      if (truncated) return;
      const entries = await workspaceService.list(rel);
      for (const entry of entries) {
        if (collected.length >= 500) {
          truncated = true;
          return;
        }
        collected.push(
          `${entry.type === "directory" ? "[dir] " : "[file]"}${entry.path}${entry.type === "file" && entry.size !== undefined ? ` (${entry.size} bytes)` : ""}`
        );
        if (entry.type === "directory" && recursive && depth < maxDepth) {
          await visit(entry.path, depth + 1);
        }
      }
    };
    await visit(dir, 1);
    void ctx;
    return ok(
      collected.join("\n") + (truncated ? "\n... listing truncated at 500 entries." : ""),
      { count: collected.length, truncated }
    );
  }
};

const readFileTool: AgentTool = {
  source: "native",
  name: "read_file",
  description:
    "Read a UTF-8 text file from the workspace. Very large files are truncated. Returns content plus line count and modification time.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path." }
    },
    required: ["path"]
  },
  async execute(args): Promise<ToolResult> {
    const target = asString(args, "path");
    const file = await workspaceService.readFile(target);
    if (file.encoding === "binary") {
      return fail(`"${file.path}" is a binary file (${file.size} bytes) and cannot be shown as text.`);
    }
    const lineCount = file.content.split("\n").length;
    const header = `# file: ${file.path} | size: ${file.size} bytes | lines: ${lineCount}${file.truncated ? " | TRUNCATED" : ""}\n`;
    return ok(header + file.content, { path: file.path, truncated: file.truncated, size: file.size, lines: lineCount });
  }
};

const writeFileTool: AgentTool = {
  source: "native",
  name: "write_file",
  description:
    "Create or fully overwrite a file inside the workspace. Parent directories are created. Prefer patch_file for targeted edits to existing files.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      content: { type: "string", description: "Complete new file content." }
    },
    required: ["path", "content"]
  },
  async execute(args, ctx): Promise<ToolResult> {
    const target = asString(args, "path");
    const content = typeof args.content === "string" ? (args.content as string) : "";
    let before: string | undefined;
    try {
      before = (await workspaceService.readFile(target)).content;
    } catch {
      before = undefined;
    }
    if (before !== undefined && before === content) {
      return ok(`No changes: ${target} already has exactly this content.`);
    }
    const rel = toWorkspaceRelative(ctx.workspaceRoot, resolveWorkspacePath(ctx.workspaceRoot, target));
    const lock = lockCheck([rel], ctx.runId);
    if (lock) return lock;
    const written = await workspaceService.writeFile(target, content);
    snapshotManager.recordFileChange(ctx.runId, ctx.callId, written.path, before ?? null, content);
    const diff = extractLineDiff(before ?? "", content);
    ctx.emitEvent("file_changed", {
      path: written.path,
      operation: before === undefined ? "create" : "modify",
      before: before?.slice(0, 200000) ?? "",
      after: content.slice(0, 200000),
      summary: `${before === undefined ? "created" : "rewritten"} (+${diff.added}/-${diff.removed})`
    });
    return ok(
      `${before === undefined ? "Created" : "Wrote"} ${written.path} (${written.size} bytes, +${diff.added}/-${diff.removed} lines).`
    );
  }
};

const patchFileTool: AgentTool = {
  source: "native",
  name: "patch_file",
  description:
    "Targeted replacement inside an existing file. The search block must appear exactly once (or set replaceAll for all occurrences). Fails with a clear message when not found or ambiguous.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      search: { type: "string", description: "Exact text to find (copy from read_file)." },
      replace: { type: "string", description: "Replacement text." },
      replaceAll: { type: "boolean", description: "Replace every occurrence (default false)." }
    },
    required: ["path", "search", "replace"]
  },
  async execute(args, ctx): Promise<ToolResult> {
    const target = asString(args, "path");
    const rel = toWorkspaceRelative(ctx.workspaceRoot, resolveWorkspacePath(ctx.workspaceRoot, target));
    const lock = lockCheck([rel], ctx.runId);
    if (lock) return lock;
    const result = await workspaceService.patchFile({
      path: target,
      search: asString(args, "search"),
      replace: typeof args.replace === "string" ? (args.replace as string) : "",
      replaceAll: asBoolean(args, "replaceAll")
    });
    snapshotManager.recordFileChange(ctx.runId, ctx.callId, result.path, result.before, result.after);
    ctx.emitEvent("file_changed", {
      path: result.path,
      operation: "modify",
      before: result.before.slice(0, 200000),
      after: result.after.slice(0, 200000),
      summary: result.summary
    });
    return ok(`Patched ${result.path}: ${result.summary}`);
  }
};

const terminalTool: AgentTool = {
  source: "native",
  name: "execute_terminal_command",
  description:
    "Run a shell command inside the workspace directory (Windows shell). Returns exit code, stdout and stderr. Output is capped and long commands time out.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Command line to execute, e.g. \"npm run test\"." },
      timeoutMs: { type: "number", description: "Optional timeout in milliseconds." }
    },
    required: ["command"]
  },
  async execute(args, ctx): Promise<ToolResult> {
    const command = asString(args, "command");
    const id = randomUUID();
    const timeoutMs = args.timeoutMs !== undefined ? asNumber(args, "timeoutMs", settingsStore.agentSettings.commandTimeoutMs) : undefined;
    const onAbort = (): void => {
      terminalService.cancel(id);
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const result = await terminalService.run({ id, command, cwd: ctx.workspaceRoot, runId: ctx.runId }, timeoutMs);
      ctx.emitEvent("terminal_finished", { callId: id, ok: result.exitCode === 0, durationMs: result.durationMs });
      // Commands can create/edit/delete files without going through our write tools —
      // nudge a full tree refresh ("*" = refresh everything expanded).
      ctx.emitEvent("file_changed", { path: "*", operation: "modify", summary: `after command: ${command.slice(0, 60)}` });
      const parts: string[] = [];
      parts.push(`exit code: ${result.exitCode === null ? "null" : result.exitCode}${result.timedOut ? " (timed out)" : ""}${result.cancelled ? " (cancelled)" : ""}`);
      if (result.stdout.trim()) parts.push(`--- stdout ---\n${result.stdout.trim()}`);
      if (result.stderr.trim()) parts.push(`--- stderr ---\n${result.stderr.trim()}`);
      if (result.truncated) parts.push("(output truncated)");
      const toolOk = result.exitCode === 0;
      return { ok: toolOk, content: parts.join("\n") || "(no output)" };
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
    }
  }
};

const searchTool: AgentTool = {
  source: "native",
  name: "search_workspace",
  description:
    "Search workspace files for text or a regular expression. node_modules, .git, dist, build and .cache are skipped. Returns path:line matches with context.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Text to search for (or regex when useRegex=true)." },
      useRegex: { type: "boolean", description: "Treat query as a JavaScript regular expression." },
      include: { type: "string", description: 'Optional filename filter glob, e.g. "*.ts".' },
      maxResults: { type: "number", description: "Maximum matches to return (default from settings)." },
      contextLines: { type: "number", description: "Context lines around each match (0-5, default 1)." }
    },
    required: ["query"]
  },
  async execute(args): Promise<ToolResult> {
    const result = await workspaceService.search(asString(args, "query"), {
      regex: asBoolean(args, "useRegex"),
      include: args.include ? asString(args, "include") : undefined,
      maxResults: args.maxResults ? asNumber(args, "maxResults", 80) : undefined,
      contextLines: args.contextLines !== undefined ? asNumber(args, "contextLines", 1) : undefined
    });
    if (result.matches.length === 0) {
      return ok(`No matches for "${asString(args, "query")}" (${result.totalFilesScanned} files scanned).`);
    }
    const text = result.matches
      .map((m) => `${m.path}:${m.line}\n${m.context.join("\n")}`)
      .join("\n\n");
    return ok(
      `${result.matches.length} match(es)${result.truncated ? " (truncated)" : ""} in ${result.totalFilesScanned} files scanned:\n\n${text}`
    );
  }
};

const scanImportsTool: AgentTool = {
  source: "native",
  name: "scan_imports",
  description:
    "Statically scan a source file's imports/requires and list their resolved local files plus exported symbols. Works for JS/TS/JSX/TSX/Python.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative source file path." }
    },
    required: ["path"]
  },
  async execute(args, ctx): Promise<ToolResult> {
    const target = asString(args, "path");
    const abs = resolveWorkspacePath(ctx.workspaceRoot, target);
    const report = await scanImports(ctx.workspaceRoot, abs);
    const lines: string[] = [`File: ${report.file}`, `Exports: ${report.exports.join(", ") || "(none detected)"}`];
    lines.push("Imports:");
    for (const imp of report.imports) {
      if (imp.resolvedPath) {
        lines.push(`  ${imp.specifier} -> ${imp.resolvedPath}${imp.exports.length ? ` [${imp.exports.join(", ")}]` : ""}`);
      }
    }
    const external = report.imports.filter((i) => !i.resolvedPath).map((i) => i.specifier);
    if (external.length > 0) lines.push(`External/unresolved: ${external.join(", ")}`);
    if (report.importedBy.length > 0) lines.push(`Imported by: ${report.importedBy.join(", ")}`);
    return ok(lines.join("\n"), { localCount: report.imports.filter((i) => i.resolvedPath).length });
  }
};

const semanticSearchTool: AgentTool = {
  source: "native",
  name: "semantic_search",
  description:
    "Find relevant code by MEANING, not exact text. Uses a local workspace index (model embeddings when an embedding provider is configured, built-in lexical embeddings otherwise). Returns the most relevant snippets with path and line range. Prefer this over walking files one-by-one when unsure where something lives.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural-language or code-flavoured question, e.g. 'where is the auth middleware'." },
      top_k: { type: "number", description: "How many snippets to return (1-20, default 8)." }
    },
    required: ["query"]
  },
  async execute(args, ctx): Promise<ToolResult> {
    const query = asString(args, "query");
    if (query.trim().length === 0) return fail("query must not be empty");
    const k = asNumber(args, "top_k", 8);
    if (vectorStore.isIndexing(ctx.workspaceRoot)) {
      return ok("The codebase index is still building right now � check the status bar. Use search_workspace or read_file for now and try semantic_search again shortly.");
    }
    try {
      const { hits, backend } = await vectorStore.search(ctx.workspaceRoot, query, k, embeddingConfig());
      if (hits.length === 0) return ok(`semantic_search (${backend}): nothing relevant found for "${query}".`);
      const body = hits.map((h, i) => `#${i + 1} ${h.path}:${h.startLine}-${h.endLine} (score ${h.score.toFixed(3)})\n${h.snippet}`).join("\n\n---\n\n");
      return ok(`semantic_search (${backend}) � ${hits.length} result(s) for "${query}":\n\n${body}`);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
};