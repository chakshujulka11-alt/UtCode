import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  History,
  Loader2,
  Play,
  Plug,
  RefreshCcw,
  FileCode2,
  FilePen,
  Search,
  ScanLine,
  SquareTerminal,
  Wrench
} from "lucide-react";
import type { AgentEvent } from "../../shared/types";
import { clsx } from "../stores/api";
import { useChatStore } from "../stores/chatStore";

const TOOL_META: Record<string, { label: string; icon: React.ReactNode }> = {
  read_file: { label: "Reading file", icon: <FileCode2 className="h-3.5 w-3.5" /> },
  write_file: { label: "Writing file", icon: <FilePen className="h-3.5 w-3.5" /> },
  patch_file: { label: "Editing file", icon: <FilePen className="h-3.5 w-3.5" /> },
  execute_terminal_command: { label: "Running command", icon: <SquareTerminal className="h-3.5 w-3.5" /> },
  search_workspace: { label: "Searching workspace", icon: <Search className="h-3.5 w-3.5" /> },
  list_directory: { label: "Listing directory", icon: <FileCode2 className="h-3.5 w-3.5" /> },
  scan_imports: { label: "Scanning imports", icon: <ScanLine className="h-3.5 w-3.5" /> }
};

export function ToolCallCard({ event }: { event: AgentEvent }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"restore" | "rerun" | null>(null);
  const [doneRestore, setDoneRestore] = useState(false);
  const running = useChatStore((s) => s.running);
  const name = event.toolName ?? "tool";
  const meta = name.startsWith("mcp.")
    ? { label: "MCP tool", icon: <Plug className="h-3.5 w-3.5" /> }
    : TOOL_META[name] ?? { label: "Using tool", icon: <Wrench className="h-3.5 w-3.5" /> };
  const isResult = event.kind === "tool_result";
  const canRewind = isResult && (name === "write_file" || name === "patch_file") && !!event.callId && !!event.runId && event.runId !== "user" && event.runId !== "system";
  const target = event.target || (event.args ? summarizeArgs(event.args) : "");

  const rewind = async (resume: boolean): Promise<void> => {
    if (!event.callId || !event.runId) return;
    setBusy(resume ? "rerun" : "restore");
    await useChatStore.getState().restoreTo(event.runId, event.callId, resume);
    setBusy(null);
    setDoneRestore(true);
  };

  return (
    <div className="my-1 overflow-hidden rounded-lg border border-edge bg-panel/80">
      <div
        role="button"
        tabIndex={0}
        className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left transition-colors duration-200 hover:bg-panel2/60"
        onClick={() => isResult && setOpen((v) => !v)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && isResult) {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span className={clsx("shrink-0", event.ok === false ? "text-red-400" : "text-accent")}>{meta.icon}</span>
        <span className="text-[13px] font-medium text-ink">{meta.label}</span>
        {target && <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{target}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {event.durationMs !== undefined && <span className="text-[11px] text-muted">{(event.durationMs / 1000).toFixed(1)}s</span>}
          {!isResult && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
          {isResult && event.ok !== false && <CircleCheck className="h-3.5 w-3.5 text-emerald-400" />}
          {isResult && event.ok === false && <CircleAlert className="h-3.5 w-3.5 text-red-400" />}
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-muted" />}
        </span>
      </div>
      {canRewind && (
        <div className="flex items-center gap-1.5 border-t border-edge/70 bg-panel2/30 px-2.5 py-1">
          {doneRestore ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400">
              <CircleCheck className="h-3 w-3" /> rolled back to here
            </span>
          ) : (
            <>
              <button
                className="btn-ghost !border-edge !bg-transparent !px-2 !py-0.5 text-[11px] hover:!border-accent/60 hover:!text-accent disabled:opacity-40"
                disabled={running || busy !== null}
                onClick={() => void rewind(false)}
                title="Revert ALL file changes made at or after this step back to the state right before it"
              >
                {busy === "restore" ? <Loader2 className="h-3 w-3 animate-spin" /> : <History className="h-3 w-3" />} Restore to this point
              </button>
              <button
                className="btn-ghost !border-edge !bg-transparent !px-2 !py-0.5 text-[11px] hover:!border-accent/60 hover:!text-accent disabled:opacity-40"
                disabled={running || busy !== null}
                onClick={() => void rewind(true)}
                title="Rewind the workspace AND the agent's context to this step, then re-run the task from here"
              >
                {busy === "rerun" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />} Restore &amp; re-run
              </button>
            </>
          )}
          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted">
            <Play className="h-2.5 w-2.5" /> time machine
          </span>
        </div>
      )}
      {open && event.result && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-edge bg-side px-3 py-2 font-mono text-[12px] text-ink/85">
          {event.result}
        </pre>
      )}
    </div>
  );
}

function summarizeArgs(args: Record<string, unknown>): string {
  for (const v of Object.values(args)) {
    if (typeof v === "string" && v.length > 0) return v.slice(0, 100);
  }
  return "";
}

export function StatusLine({ event }: { event: AgentEvent }) {
  if (event.kind === "error") {
    return <div className="my-1 rounded-lg border border-red-500/40 bg-red-950/30 px-2.5 py-1.5 text-[13px] text-red-300">{event.text}</div>;
  }
  return <div className="my-0.5 flex items-center gap-1.5 text-[12px] text-muted">{event.text ?? event.status}</div>;
}
