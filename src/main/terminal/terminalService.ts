import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { MAX_TERMINAL_OUTPUT_CHARS } from "../../shared/constants";
import type { ProcessStatus, TerminalExecution, TerminalOutputChunk, TerminalRunResult } from "../../shared/types";
import { logger } from "../services/logger";
import { settingsStore } from "../services/settingsStore";
import { isInside } from "../workspace/pathSecurity";

export type TerminalEventSink = (chunk: TerminalOutputChunk) => void;

interface RunningProcess {
  id: string;
  command: string;
  child: ChildProcessWithoutNullStreams;
  startedAt: number;
  timer: NodeJS.Timeout | null;
  killed: boolean;
  timedOut: boolean;
}

class TerminalService {
  private running = new Map<string, RunningProcess>();
  private byRun = new Map<string, Set<string>>();
  private sink: TerminalEventSink = () => undefined;
  private allowedCwds: string[] = [];

  setEventSink(sink: TerminalEventSink): void {
    this.sink = sink;
  }

  registerWorkspaceCwd(root: string): void {
    // most-recent workspace must be LAST — run() treats the last entry as the active root
    this.allowedCwds = [...this.allowedCwds.filter((c) => c !== root), root];
  }

  private track(runId: string | undefined, id: string): void {
    if (!runId) return;
    let set = this.byRun.get(runId);
    if (!set) {
      set = new Set();
      this.byRun.set(runId, set);
    }
    set.add(id);
  }

  private untrack(id: string): void {
    for (const [runId, set] of this.byRun) {
      set.delete(id);
      if (set.size === 0) this.byRun.delete(runId);
    }
  }

  /** Kill every child process spawned by a specific agent run. */
  cancelForRun(runId: string): number {
    const ids = this.byRun.get(runId);
    if (!ids) return 0;
    let n = 0;
    for (const id of [...ids]) {
      if (this.cancel(id)) n++;
    }
    return n;
  }

  private emit(id: string, stream: TerminalOutputChunk["stream"], data: string): void {
    this.sink({ id, stream, data });
  }

  status(id: string): ProcessStatus | null {
    const entry = this.running.get(id);
    if (!entry) return null;
    return { id, running: true, command: entry.command, startedAt: entry.startedAt };
  }

  activeCount(): number {
    return this.running.size;
  }

  cancelAll(): void {
    for (const id of [...this.running.keys()]) this.cancel(id);
  }

  cancel(id: string): boolean {
    const entry = this.running.get(id);
    if (!entry) return false;
    entry.killed = true;
    this.emit(id, "system", `\n[utcode] Terminating process ${id}…\n`);
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(entry.child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        entry.child.kill("SIGKILL");
      }
    } catch (err) {
      logger.warn("terminal", `cancel failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return true;
  }

  async run(exec: TerminalExecution, timeoutMs?: number): Promise<TerminalRunResult> {
    const root = this.allowedCwds[this.allowedCwds.length - 1];
    if (!root) throw new Error("No workspace is open. Commands must run inside an opened workspace.");
    const cwd = exec.cwd ? path.resolve(exec.cwd) : root;
    if (!isInside(root, cwd)) {
      throw new Error(`Refusing to run outside the workspace: ${cwd}`);
    }
    const limit = timeoutMs ?? settingsStore.agentSettings.commandTimeoutMs;
    const startedAt = Date.now();
    this.emit(exec.id, "system", `$ ${exec.command}\n(working directory: ${cwd})\n`);

    return new Promise<TerminalRunResult>((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(exec.command, {
          cwd,
          shell: true,
          windowsHide: true,
          env: { ...process.env, TERM: "dumb", NO_COLOR: "1" }
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit(exec.id, "stderr", message + "\n");
        resolve({
          id: exec.id,
          command: exec.command,
          exitCode: -1,
          stdout: "",
          stderr: message,
          durationMs: Date.now() - startedAt,
          timedOut: false,
          cancelled: false,
          truncated: false
        });
        return;
      }

      let stdout = "";
      let stderr = "";
      let truncated = false;
      let settled = false;
      const entry: RunningProcess = {
        id: exec.id,
        command: exec.command,
        child,
        startedAt,
        timer: null,
        killed: false,
        timedOut: false
      };
      this.running.set(exec.id, entry);
      this.track(exec.runId, exec.id);

      const append = (stream: "stdout" | "stderr", text: string): void => {
        const target = stream === "stdout" ? "stdout" : "stderr";
        const current = target === "stdout" ? stdout : stderr;
        if (current.length >= MAX_TERMINAL_OUTPUT_CHARS) {
          truncated = true;
          return;
        }
        const room = MAX_TERMINAL_OUTPUT_CHARS - current.length;
        const slice = text.slice(0, room);
        if (target === "stdout") stdout += slice;
        else stderr += slice;
        this.emit(exec.id, stream, slice);
        if (text.length > slice.length) {
          truncated = true;
          this.emit(exec.id, "system", "\n[utcode] Output exceeded capture limit and was truncated.\n");
        }
      };

      child.stdout.on("data", (d: Buffer) => append("stdout", d.toString("utf-8")));
      child.stderr.on("data", (d: Buffer) => append("stderr", d.toString("utf-8")));

      const timer = setTimeout(() => {
        entry.timedOut = true;
        this.emit(exec.id, "system", `\n[utcode] Command timed out after ${limit} ms. Killing process.\n`);
        this.cancel(exec.id);
      }, limit);
      timer.unref?.();
      entry.timer = timer;

      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        if (entry.timer) clearTimeout(entry.timer);
        this.running.delete(exec.id);
        this.untrack(exec.id);
        const durationMs = Date.now() - startedAt;
        this.emit(
          exec.id,
          "system",
          `\n[utcode] Exit code: ${exitCode ?? (entry.killed ? "killed" : "unknown")} (${Math.round(durationMs / 100) / 10}s)\n`
        );
        resolve({
          id: exec.id,
          command: exec.command,
          exitCode,
          stdout,
          stderr,
          durationMs,
          timedOut: entry.timedOut,
          cancelled: entry.killed && !entry.timedOut,
          truncated
        });
      };

      child.on("error", (err) => {
        stderr += `\n${err.message}`;
        this.emit(exec.id, "stderr", err.message + "\n");
        finish(-1);
      });
      child.on("close", (code) => finish(code));
    });
  }
}

export const terminalService = new TerminalService();
