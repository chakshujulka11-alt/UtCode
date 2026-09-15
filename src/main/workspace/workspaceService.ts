import fs from "node:fs/promises";
import path from "node:path";
import { BINARY_EXTENSIONS, IGNORED_DIRECTORIES } from "../../shared/constants";
import type {
  FileContent,
  PatchRequest,
  PatchResult,
  SearchResult,
  WorkspaceFileInfo
} from "../../shared/types";
import { settingsStore } from "../services/settingsStore";
import { PathSecurityError, resolveWorkspacePath, toWorkspaceRelative } from "./pathSecurity";
import { extractLineDiff } from "../tools/textDiff";
import { fileWatcher } from "../fileSystem/fileWatcher";

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".py": "python",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".md": "markdown",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".sh": "shell",
  ".ps1": "powershell",
  ".sql": "sql",
  ".xml": "xml",
  ".toml": "ini"
};

export function detectLanguage(filePath: string): string | undefined {
  return LANGUAGE_BY_EXT[path.extname(filePath).toLowerCase()];
}

export function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export class WorkspaceService {
  private root: string | null = null;

  getRoot(): string | null {
    return this.root;
  }

  requireRoot(): string {
    if (!this.root) throw new Error("No workspace is open. Choose a folder first.");
    return this.root;
  }

  open(root: string, rememberRecent = true): string {
    const resolved = path.resolve(root);
    this.root = resolved;
    if (rememberRecent) settingsStore.addRecentWorkspace(resolved);
    return resolved;
  }

  close(): void {
    this.root = null;
  }

  async list(dir: string): Promise<WorkspaceFileInfo[]> {
    const root = this.requireRoot();
    const abs = resolveWorkspacePath(root, dir || root);
    const stat = await fs.stat(abs);
    if (!stat.isDirectory()) throw new Error(`Not a directory: ${dir}`);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const files: WorkspaceFileInfo[] = [];
    for (const entry of entries) {
      const full = path.join(abs, entry.name);
      const rel = toWorkspaceRelative(root, full);
      const isDir = entry.isDirectory();
      if (isDir && IGNORED_DIRECTORIES.includes(entry.name.toLowerCase()) && dir !== root) {
        files.push({ name: entry.name, path: rel, type: "directory", size: 0 });
        continue;
      }
      let size: number | undefined;
      if (!isDir) {
        try {
          size = (await fs.stat(full)).size;
        } catch {
          size = undefined;
        }
      }
      files.push({ name: entry.name, path: rel, type: isDir ? "directory" : "file", size });
    }
    files.sort((a, b) =>
      a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })
    );
    return files;
  }

  async readFile(target: string): Promise<FileContent> {
    const root = this.requireRoot();
    const abs = resolveWorkspacePath(root, target);
    const stat = await fs.stat(abs);
    if (stat.isDirectory()) throw new Error(`Path is a directory: ${target}`);
    const rel = toWorkspaceRelative(root, abs);
    const maxBytes = settingsStore.agentSettings.maxFileSizeBytes;
    if (stat.size > maxBytes) {
      const handle = await fs.open(abs, "r");
      try {
        const buf = Buffer.alloc(maxBytes);
        await handle.read(buf, 0, maxBytes, 0);
        return {
          path: rel,
          content: buf.toString("utf-8"),
          encoding: "utf-8",
          size: stat.size,
          modifiedAt: stat.mtimeMs,
          truncated: true,
          language: detectLanguage(abs)
        };
      } finally {
        await handle.close();
      }
    }
    const buf = await fs.readFile(abs);
    if (BINARY_EXTENSIONS.has(path.extname(abs).toLowerCase()) || looksBinary(buf)) {
      return {
        path: rel,
        content: "",
        encoding: "binary",
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        truncated: false,
        language: undefined
      };
    }
    return {
      path: rel,
      content: buf.toString("utf-8"),
      encoding: "utf-8",
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      truncated: false,
      language: detectLanguage(abs)
    };
  }

  async writeFile(target: string, content: string): Promise<FileContent> {
    const root = this.requireRoot();
    const abs = resolveWorkspacePath(root, target);
    fileWatcher.markSelfWrite(abs);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
    const stat = await fs.stat(abs);
    return {
      path: toWorkspaceRelative(root, abs),
      content,
      encoding: "utf-8",
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      truncated: false,
      language: detectLanguage(abs)
    };
  }

  async patchFile(req: PatchRequest): Promise<PatchResult> {
    const root = this.requireRoot();
    const abs = resolveWorkspacePath(root, req.path);
    let current: string;
    try {
      current = await fs.readFile(abs, "utf-8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") throw new Error(`File does not exist: ${req.path}. Use write_file to create it.`);
      throw err;
    }
    if (!req.search || req.search.length === 0) throw new Error("Search block must not be empty.");
    let haystack = current;
    let needle = req.search;
    let normalizedEol = false;
    let occurrences = findAllIndexes(haystack, needle);
    if (occurrences.length === 0) {
      haystack = current.replace(/\r\n/g, "\n");
      needle = req.search.replace(/\r\n/g, "\n");
      occurrences = findAllIndexes(haystack, needle);
      normalizedEol = occurrences.length > 0;
    }
    if (occurrences.length === 0) {
      throw new Error(
        `No exact match found for the search block in ${req.path}. Read the file again and copy the exact text.`
      );
    }
    if (occurrences.length > 1 && !req.replaceAll) {
      throw new Error(
        `Ambiguous match: the search block appears ${occurrences.length} times in ${req.path}. Provide a larger, unique search block or set replaceAll.`
      );
    }
    const replacement = needle.endsWith("\n") && !req.replace.endsWith("\n") ? req.replace + "\n" : req.replace;
    let updated: string;
    if (req.replaceAll) {
      updated = haystack.split(needle).join(replacement);
    } else {
      const at = occurrences[0];
      updated = haystack.slice(0, at) + replacement + haystack.slice(at + needle.length);
    }
    const diff = extractLineDiff(current, updated);
    fileWatcher.markSelfWrite(abs);
    await fs.writeFile(abs, updated, "utf-8");
    return {
      path: toWorkspaceRelative(root, abs),
      applied: true,
      replacements: req.replaceAll ? occurrences.length : 1,
      linesAdded: diff.added,
      linesRemoved: diff.removed,
      before: current,
      after: updated,
      summary: `+${diff.added} / -${diff.removed} lines in ${req.path}${normalizedEol ? " (line endings normalized to LF)" : ""}`
    };
  }

  async search(
    query: string,
    opts?: { regex?: boolean; include?: string; maxResults?: number; contextLines?: number; rootDir?: string }
  ): Promise<SearchResult> {
    const root = opts?.rootDir ?? this.requireRoot();
    const maxResults = Math.min(opts?.maxResults ?? settingsStore.agentSettings.maxSearchResults, 400);
    const contextLines = Math.min(opts?.contextLines ?? 1, 5);
    if (!query || query.trim().length === 0) throw new Error("Search query must not be empty.");

    let matcher: (line: string) => number;
    if (opts?.regex) {
      let re: RegExp;
      try {
        re = new RegExp(query);
      } catch (err) {
        throw new Error(`Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`);
      }
      matcher = (line) => line.search(re);
    } else {
      const lower = query.toLowerCase();
      matcher = (line) => line.toLowerCase().indexOf(lower);
    }

    const includeRe = opts?.include
      ? new RegExp(
          "^" +
            opts.include
              .split(/[/\\]/)
              .pop()!
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*/g, ".*")
              .replace(/\?/g, ".") +
            "$",
          "i"
        )
      : null;

    const matches: SearchResult["matches"] = [];
    let totalFilesScanned = 0;
    let truncated = false;

    const walk = async (dir: string): Promise<boolean> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return true;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORIES.includes(entry.name.toLowerCase())) continue;
          if (!(await walk(full))) return false;
          continue;
        }
        if (!entry.isFile()) continue;
        if (includeRe && !includeRe.test(entry.name)) continue;
        if (BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        totalFilesScanned++;
        let stat;
        try {
          stat = await fs.stat(full);
        } catch {
          continue;
        }
        if (stat.size > settingsStore.agentSettings.maxFileSizeBytes) continue;
        let text: string;
        try {
          text = await fs.readFile(full, "utf-8");
        } catch {
          continue;
        }
        if (text.includes("\0")) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const col = matcher(lines[i]);
          if (col < 0) continue;
          const start = Math.max(0, i - contextLines);
          const end = Math.min(lines.length - 1, i + contextLines);
          const ctx: string[] = [];
          for (let j = start; j <= end; j++) {
            ctx.push(`${j + 1 === i + 1 ? ">" : " "} ${j + 1}| ${lines[j]}`);
          }
          matches.push({
            path: toWorkspaceRelative(root, full),
            line: i + 1,
            column: col + 1,
            preview: lines[i].slice(0, 400),
            context: ctx
          });
          if (matches.length >= maxResults) {
            truncated = true;
            return false;
          }
          break;
        }
      }
      return true;
    };

    await walk(root);
    return { matches, truncated, totalFilesScanned };
  }
}

function findAllIndexes(haystack: string, needle: string): number[] {
  const indexes: number[] = [];
  let from = 0;
  while (indexes.length < 64) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    indexes.push(idx);
    from = idx + Math.max(needle.length, 1);
  }
  return indexes;
}

export const workspaceService = new WorkspaceService();
export { PathSecurityError, resolveWorkspacePath };
