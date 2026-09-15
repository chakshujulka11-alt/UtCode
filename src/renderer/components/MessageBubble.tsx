import { useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Sparkles, User } from "lucide-react";
import type { AgentEvent, ChatMessage } from "../../shared/types";
import { ToolCallCard, StatusLine } from "./ToolCallCard";
import { useUiStore } from "../stores/uiStore";

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    const text = ref.current?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      useUiStore.getState().toastMessage("Copied! code block is on your clipboard", "info");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      useUiStore.getState().toastMessage("Clipboard unavailable", "error");
    }
  };
  return (
    <div className="group relative">
      <pre ref={ref}>{children}</pre>
      <button
        className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-edge bg-panel px-2 py-0.5 text-[11px] text-muted opacity-0 shadow transition-all duration-200 hover:text-ink group-hover:opacity-100"
        onClick={() => void copy()}
        title="Copy code block"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

const mdComponents: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>
};

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-panel2 text-muted">
          <User className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1 whitespace-pre-wrap break-words overflow-wrap-anywhere rounded-xl rounded-tl-sm bg-panel2 px-3.5 py-2.5 text-[14px] leading-relaxed text-ink [overflow-wrap:anywhere]">
          {message.text}
        </div>
      </div>
    );
  }

  const events: AgentEvent[] = message.toolEvents ?? [];
  const timeline: Array<{ kind: "event"; event: AgentEvent } | { kind: "final" }> = [];
  for (const ev of events) {
    if (ev.kind === "tool_started" || ev.kind === "tool_result") {
      timeline.push({ kind: "event", event: ev });
    } else if (ev.kind === "thinking" || ev.kind === "error" || ev.kind === "agent_started") {
      timeline.push({ kind: "event", event: ev });
    }
  }
  timeline.push({ kind: "final" });

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        {timeline.map((item, idx) =>
          item.kind === "event" ? (
            item.event.kind === "tool_started" || item.event.kind === "tool_result" ? (
              <ToolCallCard key={idx} event={item.event} />
            ) : (
              <StatusLine key={idx} event={item.event} />
            )
          ) : (
            <div key={idx}>
              {message.text.length > 0 && (
                <div className="md-body text-[14px] text-ink">
                  <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{message.text}</Markdown>
                </div>
              )}
              {message.streaming && (
                <div className="mt-1 flex items-center gap-1 text-xs text-muted">
                  <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-accent" />
                  working…
                </div>
              )}
              {message.status === "error" && <div className="mt-1 text-xs text-red-400">Task ended with an error.</div>}
              {message.status === "cancelled" && <div className="mt-1 text-xs text-muted">Task cancelled.</div>}
            </div>
          )
        )}
      </div>
    </div>
  );
}
