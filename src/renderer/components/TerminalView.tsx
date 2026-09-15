import { useEffect, useRef, useState } from "react";
import { CircleCheck, Loader2, Square, Trash2 } from "lucide-react";
import { useTerminalStore } from "../stores/terminalStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { clsx } from "../stores/api";

export function TerminalView() {
  const { sessions, busy, runCommand, cancel, clearFinished } = useTerminalStore();
  const root = useWorkspaceStore((s) => s.root);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const running = sessions.find((s) => s.running);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sessions]);

  return (
    <div className="flex h-full flex-col bg-side">
      <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
        <span className="text-xs text-muted">{running ? `running: ${running.command.slice(0, 60)}` : "Workspace terminal"}</span>
        <div className="flex gap-1">
          {running && (
            <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => void cancel(running.id)}>
              <Square className="h-3 w-3" /> Stop
            </button>
          )}
          <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={clearFinished} title="Clear finished sessions">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed">
        {sessions.length === 0 && (
          <div className="text-muted">
            No terminal session yet. Run a command below, or watch agent commands stream here.
          </div>
        )}
        {sessions.map((s) => (
          <div key={s.id} className="mb-3">
            <div className="flex items-center gap-2 text-accent">
              {s.running ? <Loader2 className="h-3 w-3 animate-spin" /> : <CircleCheck className={clsx("h-3 w-3", s.exitCode === 0 ? "text-emerald-400" : "text-red-400")} />}
              <span className="text-ink">$ {s.command}</span>
              {s.exitCode !== null && !s.running && <span className="text-muted">exit {s.exitCode}{s.timedOut ? " (timeout)" : ""}{s.cancelled ? " (cancelled)" : ""}</span>}
            </div>
            <pre className="whitespace-pre-wrap break-words text-ink/80">{s.output}</pre>
          </div>
        ))}
      </div>
      <form
        className="flex items-center gap-2 border-t border-edge px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          const cmd = input;
          setInput("");
          void runCommand(cmd);
        }}
      >
        <span className="text-xs text-accent">{root ? ">" : "(no workspace)"}</span>
        <input
          className="flex-1 bg-transparent font-mono text-[13px] text-ink placeholder:text-muted focus:outline-none"
          placeholder={root ? "npm run build" : "Open a workspace first"}
          value={input}
          disabled={!root || busy}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn-ghost !px-2 !py-0.5 text-xs" disabled={!root || busy}>
          Run
        </button>
      </form>
    </div>
  );
}
