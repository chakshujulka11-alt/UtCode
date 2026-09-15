import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { IGNORED_DIRECTORIES } from "../../shared/constants";
import { classifyOperation, type FileChangeOperation } from "./fileIO";

type ChangeListener = (relPath: string, operation: FileChangeOperation) => void;

const DEBOUNCE_MS = 300;
const SELF_WRITE_SUPPRESS_MS = 2000;

/**
 * IMPORTANT (loop guard): while an agent run is active, watcher events are
 * DROPPED (not queued) — an agent writing/reading many files otherwise feeds
 * the watcher, which refreshes the tree, which keeps the agent "re-checking"
 * forever. When the last agent finishes we flush exactly ONE coalesced "*"
 * refresh so the tree ends up correct. Our own programmatic writes are also
 * marked as self-writes and ignored briefly, covering idle-time saves.
 */
class FileWatcher {
  private watcher: fs.FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private pending = new Map<string, string>();
  private listener: ChangeListener | null = null;
  private root: string | null = null;
  private agentWorkCount = 0;
  private droppedWhileBusy = 0;
  private selfWrites = new Map<string, number>();

  isRunning(): boolean {
    return this.watcher !== null;
  }

  /** Ref-counted: true while any agent run is active. */
  setAgentWorking(working: boolean): void {
    if (working) {
      this.agentWorkCount += 1;
      return;
    }
    this.agentWorkCount = Math.max(0, this.agentWorkCount - 1);
    if (this.agentWorkCount === 0 && this.droppedWhileBusy > 0 && this.listener) {
      this.droppedWhileBusy = 0;
      // one coalesced refresh once everything settles
      const flushTimer = setTimeout(() => {
        try {
          this.listener?.("*", "modify");
        } catch {
          /* listener must not kill watcher */
        }
      }, DEBOUNCE_MS + 50);
      flushTimer.unref?.();
    }
  }

  get agentBusy(): boolean {
    return this.agentWorkCount > 0;
  }

  /** Non-destructive peek (tests/telemetry). */
  get droppedWhileBusyCount(): number {
    return this.droppedWhileBusy;
  }

  consumeDroppedWhileBusy(): number {
    const n = this.droppedWhileBusy;
    this.droppedWhileBusy = 0;
    return n;
  }

  /** Call immediately before/after any utcode-initiated write to abs path. */
  markSelfWrite(absPath: string): void {
    this.selfWrites.set(path.resolve(absPath), Date.now());
    if (this.selfWrites.size > 256) {
      const cutoff = Date.now() - SELF_WRITE_SUPPRESS_MS * 2;
      for (const [p, t] of this.selfWrites) {
        if (t < cutoff) this.selfWrites.delete(p);
      }
    }
  }

  private isSelfWrite(absPath: string): boolean {
    const t = this.selfWrites.get(path.resolve(absPath));
    if (t === undefined) return false;
    if (Date.now() - t > SELF_WRITE_SUPPRESS_MS) {
      this.selfWrites.delete(path.resolve(absPath));
      return false;
    }
    return true;
  }

  start(root: string, onChange: ChangeListener): void {
    this.stop();
    this.listener = onChange;
    this.root = root;
    try {
      this.watcher = fs.watch(root, { recursive: true }, (event, filename) => {
        if (!this.listener) return;
        // Loop guard: never react while an agent is working — the flush at
        // run-end refreshes the tree once instead of storming per event.
        if (this.agentWorkCount > 0) {
          this.droppedWhileBusy += 1;
          return;
        }
        // Windows sometimes emits with a null filename (buffer pressure) — do a
        // full-tree refresh instead of dropping the event.
        if (!filename) {
          if (this.timer) clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            this.timer = null;
            this.pending.clear();
            try {
              this.listener?.("*", "modify");
            } catch {
              /* listener must not kill watcher */
            }
          }, 100);
          this.timer.unref?.();
          return;
        }
        const rel = filename.toString().split(path.sep).join("/");
        const parts = rel.split("/");
        if (parts.some((seg) => seg === ".utcode" || IGNORED_DIRECTORIES.includes(seg.toLowerCase()))) return;
        const abs = path.join(root, rel);
        if (this.isSelfWrite(abs)) return;
        this.pending.set(rel, event);
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          const items = [...this.pending.entries()];
          this.pending.clear();
          for (const [relPath, eventType] of items) {
            const absPath = path.join(this.root ?? root, relPath);
            if (this.isSelfWrite(absPath)) continue;
            void fsp
              .stat(absPath)
              .then(() => true, () => false)
              .then((exists) => {
                try {
                  this.listener?.(relPath, classifyOperation(eventType, absPath, exists));
                } catch {
                  /* listener must not kill watcher */
                }
              });
          }
        }, DEBOUNCE_MS);
        this.timer.unref?.();
      });
      this.watcher.on("error", () => this.stop());
    } catch {
      /* recursive watch unsupported on this platform; manual refresh still works */
    }
  }

  stop(): void {
    try {
      this.watcher?.close();
    } catch {
      /* already closed */
    }
    this.watcher = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    this.listener = null;
    this.root = null;
  }
}

export const fileWatcher = new FileWatcher();
export { FileWatcher };
