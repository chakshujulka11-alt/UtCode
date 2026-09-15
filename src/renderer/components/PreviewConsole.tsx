import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, TerminalSquare, Trash2 } from "lucide-react";
import { usePreviewStore } from "../stores/previewStore";
import { clsx } from "../stores/api";

const LEVEL_CLASS: Record<string, string> = {
  error: "text-red-400",
  warning: "text-amber-400",
  info: "text-sky-400",
  log: "text-ink/85"
};

export function PreviewConsole() {
  const [open, setOpen] = useState(false);
  const lines = usePreviewStore((s) => s.lines);
  const clearLines = usePreviewStore((s) => s.clearLines);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  const errors = lines.filter((l) => l.level === "error").length;

  return (
    <div className="shrink-0 border-t border-edge bg-side">
      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-muted transition-colors duration-200 hover:text-ink" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <TerminalSquare className="h-3.5 w-3.5 text-accent" />
        <span className="font-medium">Preview Console</span>
        <span className="text-muted/70">{lines.length} line(s){errors > 0 ? ` · ${errors} error(s)` : ""}</span>
        {open && (
          <span
            className="ml-auto rounded p-0.5 hover:text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              clearLines();
            }}
            title="Clear console"
          >
            <Trash2 className="h-3 w-3" />
          </span>
        )}
      </button>
      {open && (
        <div ref={boxRef} className="max-h-44 min-h-20 overflow-y-auto px-3 pb-2 font-mono text-[11px] leading-relaxed">
          {lines.length === 0 && <div className="py-2 text-muted/60">console.log / errors from the previewed page appear here</div>}
          {lines.map((l, i) => (
            <div key={`${l.at}-${i}`} className={clsx("whitespace-pre-wrap break-words", LEVEL_CLASS[l.level] ?? "text-ink/85")}>
              <span className="mr-1.5 text-muted/50">{new Date(l.at).toLocaleTimeString()}</span>
              {l.message}
              {l.source && l.line ? <span className="ml-2 text-muted/50">({String(l.source).split("/").pop()}:{l.line})</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
