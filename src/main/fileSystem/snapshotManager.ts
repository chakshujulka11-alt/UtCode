import fsp from "node:fs/promises";
import path from "node:path";
import type { UnifiedMessage } from "../providers/providerTypes";
import { resolveWorkspacePath } from "../workspace/pathSecurity";

export interface CheckpointFileRecord {
  path: string;
  /** previous content; null = file did not exist before this step */
  before: string | null;
  /** content right after this step; null = file was removed by this step */
  after: string | null;
}

export interface MergeFileEntry {
  path: string;
  before: string | null;
  after: string | null;
  edits: number;
}

export interface Checkpoint {
  runId: string;
  callId: string;
  toolName: string;
  task: string;
  workspaceRoot: string;
  timestamp: number;
  files: CheckpointFileRecord[];
  /** agent messages exactly as they were BEFORE this tool call ran (memory-only) */
  messages: UnifiedMessage[] | null;
}

export interface RestoredFile {
  path: string;
  content: string | null;
}

export interface RestoreOutcome {
  restoredFiles: RestoredFile[];
  remainingCheckpoints: number;
  task: string;
  messages: UnifiedMessage[] | null;
}

const MAX_CHECKPOINTS_PER_RUN = 400;
const MAX_TRACKED_FILE_CHARS = 2_000_000;

function key(runId: string, callId: string): string {
  return `${runId}|${callId}`;
}

function sanitizeForDisk(relPath: string): string {
  return relPath.replace(/[<>:"/\\|?*]/g, "_");
}

class SnapshotManager {
  private byRun = new Map<string, Checkpoint[]>();
  private open = new Map<string, Checkpoint>();

  start(cp: Omit<Checkpoint, "files">): void {
    let list = this.byRun.get(cp.runId);
    if (!list) {
      list = [];
      this.byRun.set(cp.runId, list);
    }
    const full: Checkpoint = { ...cp, files: [] };
    list.push(full);
    if (list.length > MAX_CHECKPOINTS_PER_RUN) list.splice(0, list.length - MAX_CHECKPOINTS_PER_RUN);
    this.open.set(key(cp.runId, cp.callId), full);
  }

  recordFileChange(runId: string, callId: string, relPath: string, before: string | null, after: string | null = null): void {
    const cp = this.open.get(key(runId, callId));
    if (!cp) return;
    if (before !== null && before.length > MAX_TRACKED_FILE_CHARS) return;
    cp.files.push({ path: relPath, before, after });
    void this.persistToDisk(cp, relPath, before);
  }

  /** Net file changes for a run: first "before", last "after" per path. */
  mergeChanges(runId: string): MergeFileEntry[] {
    const map = new Map<string, MergeFileEntry>();
    for (const cp of this.byRun.get(runId) ?? []) {
      for (const f of cp.files) {
        const entry = map.get(f.path) ?? { path: f.path, before: f.before, after: f.after, edits: 0 };
        entry.after = f.after;
        entry.edits += 1;
        map.set(f.path, entry);
      }
    }
    return [...map.values()];
  }

  /** Call when the tool finished. Returns true when the checkpoint was kept (it changed files). */
  finish(runId: string, callId: string): boolean {
    const k = key(runId, callId);
    const cp = this.open.get(k);
    this.open.delete(k);
    if (!cp) return false;
    if (cp.files.length === 0) {
      const list = this.byRun.get(runId);
      if (list) {
        const idx = list.indexOf(cp);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) this.byRun.delete(runId);
      }
      return false;
    }
    return true;
  }

  /** Keep full message snapshots only for the most recent checkpoints to bound memory. */
  pruneMessages(keep = 40): void {
    for (const list of this.byRun.values()) {
      for (let i = 0; i < list.length - keep; i++) list[i].messages = null;
    }
  }

  count(runId?: string): number {
    if (runId) return this.byRun.get(runId)?.length ?? 0;
    let n = 0;
    for (const list of this.byRun.values()) n += list.length;
    return n;
  }

  latestRunIdWithCheckpoints(): string | null {
    let best: { id: string; ts: number } | null = null;
    for (const [runId, list] of this.byRun) {
      const last = list[list.length - 1];
      if (!last) continue;
      if (!best || last.timestamp > best.ts) best = { id: runId, ts: last.timestamp };
    }
    return best?.id ?? null;
  }

  clearAll(): void {
    this.byRun.clear();
    this.open.clear();
  }

  clearRun(runId: string): void {
    this.byRun.delete(runId);
    for (const k of [...this.open.keys()]) {
      if (k.startsWith(`${runId}|`)) this.open.delete(k);
    }
  }

  async restore(root: string, runId: string, callId: string): Promise<RestoreOutcome> {
    const list = this.byRun.get(runId) ?? [];
    if (list.length === 0) {
      throw new Error(
        "No checkpoints available for this run. File snapshots live in memory while utcode is open — restores are not possible after an app restart."
      );
    }
    const idx = callId === "__all__" ? 0 : list.findIndex((c) => c.callId === callId);
    if (idx < 0) {
      throw new Error("That checkpoint no longer exists (it may have been rolled back already).");
    }
    const target = list[idx];
    const touched = new Set<string>();
    const restored: RestoredFile[] = [];
    for (let i = list.length - 1; i >= idx; i--) {
      for (const file of list[i].files) {
        if (touched.has(file.path)) continue;
        touched.add(file.path);
        const abs = resolveWorkspacePath(root, file.path);
        if (file.before === null) {
          await fsp.rm(abs, { force: true });
          restored.push({ path: file.path, content: null });
        } else {
          await fsp.mkdir(path.dirname(abs), { recursive: true });
          await fsp.writeFile(abs, file.before, "utf-8");
          restored.push({ path: file.path, content: file.before });
        }
      }
    }
    const kept = list.slice(0, idx);
    if (kept.length > 0) this.byRun.set(runId, kept);
    else this.byRun.delete(runId);
    for (const k of [...this.open.keys()]) {
      const cp = this.open.get(k);
      if (cp && cp.timestamp >= target.timestamp && cp.runId === runId) this.open.delete(k);
    }
    return {
      restoredFiles: restored,
      remainingCheckpoints: kept.length,
      task: target.task,
      messages: target.messages
    };
  }

  private async persistToDisk(cp: Checkpoint, relPath: string, before: string | null): Promise<void> {
    try {
      const dir = path.join(cp.workspaceRoot, ".utcode", "snapshots");
      await fsp.mkdir(dir, { recursive: true });
      const name = `${new Date(cp.timestamp).toISOString().replace(/[:.]/g, "-")}_${sanitizeForDisk(relPath)}${before === null ? ".DELETED" : ""}`;
      if (before !== null) {
        await fsp.writeFile(path.join(dir, name), before, "utf-8");
      } else {
        await fsp.writeFile(path.join(dir, `${name}.marker`), `file ${relPath} did not exist before checkpoint ${cp.toolName}\n`, "utf-8");
      }
    } catch {
      /* disk audit trail is best-effort; in-memory copy is the source of truth */
    }
  }
}

export const snapshotManager = new SnapshotManager();
