import { create } from "zustand";
import type { TerminalOutputChunk } from "../../shared/types";
import { api, call } from "./api";

export interface TerminalSession {
  id: string;
  command: string;
  output: string;
  running: boolean;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  cancelled: boolean;
  timedOut: boolean;
}

const MAX_OUTPUT_CHARS = 60000;

interface TerminalState {
  sessions: TerminalSession[];
  currentId: string | null;
  busy: boolean;
  onChunk(chunk: TerminalOutputChunk): void;
  runCommand(command: string): Promise<void>;
  cancel(id: string): Promise<void>;
  clearFinished(): void;
}

function ensureSession(set: (fn: (s: TerminalState) => Partial<TerminalState>) => void, get: () => TerminalState, id: string): void {
  if (get().sessions.some((s) => s.id === id)) return;
  set((s) => ({
    sessions: [
      ...s.sessions.slice(-40),
      { id, command: "(running…)", output: "", running: true, exitCode: null, startedAt: Date.now(), finishedAt: null, cancelled: false, timedOut: false }
    ]
  }));
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  currentId: null,
  busy: false,

  onChunk(chunk) {
    ensureSession(set, get, chunk.id);
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== chunk.id) return sess;
        let command = sess.command;
        let output = sess.output;
        if (chunk.stream === "system" && command === "(running…)") {
          const m = /^\$\s(.*)$/m.exec(chunk.data);
          if (m) command = m[1];
          const dir = /\(working directory: (.*)\)/.exec(chunk.data);
          if (dir) output += `in ${dir[1]}\n`;
        }
        const prefix = chunk.stream === "stderr" ? "" : "";
        output = (output + prefix + chunk.data).slice(-MAX_OUTPUT_CHARS);
        return { ...sess, command, output };
      })
    }));
  },

  async runCommand(command: string) {
    const trimmed = command.trim();
    if (!trimmed || get().busy) return;
    set({ busy: true });
    try {
      const result = await call(api.utcode.terminalRun(trimmed));
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === result.id
            ? {
                ...sess,
                command: result.command,
                running: false,
                exitCode: result.exitCode,
                finishedAt: Date.now(),
                cancelled: result.cancelled,
                timedOut: result.timedOut,
                output: (sess.output + (result.truncated ? "\n[output truncated]\n" : "")).slice(-MAX_OUTPUT_CHARS)
              }
            : sess
        )
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({
        sessions: [
          ...s.sessions,
          {
            id: `local-${Date.now()}`,
            command: trimmed,
            output: `Error: ${message}`,
            running: false,
            exitCode: -1,
            startedAt: Date.now(),
            finishedAt: Date.now(),
            cancelled: false,
            timedOut: false
          }
        ]
      }));
    } finally {
      set({ busy: false });
    }
  },

  async cancel(id: string) {
    try {
      await call(api.utcode.terminalCancel(id));
    } catch {
      /* ignore */
    }
    set((s) => ({ sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, cancelled: true } : sess)) }));
  },

  clearFinished() {
    set((s) => ({ sessions: s.sessions.filter((sess) => sess.running) }));
  }
}));
