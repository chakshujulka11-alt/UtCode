import { useEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { ComposerModelPicker } from "./ComposerModelPicker";
import { RouterModeChip } from "./RouterModeChip";

export function Composer() {
  const [text, setText] = useState("");
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const running = useChatStore((s) => (s.activeId ? !!s.runningChats[s.activeId] : false));
  const root = useWorkspaceStore((s) => s.root);
  const providers = useSettingsStore((s) => s.providers);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [text]);

  const hasProvider = providers.some((p) => p.enabled);
  const blocked = !root ? "Open a workspace folder first" : !hasProvider ? "Configure an AI provider in Settings first" : "";

  const submit = (): void => {
    if (running || !text.trim() || blocked) return;
    const task = text;
    setText("");
    void send(task);
  };

  return (
    <div className="border-t border-edge bg-canvas px-4 py-3">
      <div className="mx-auto max-w-3xl">
        {blocked && <div className="mb-1.5 text-xs text-amber-400/90">{blocked}</div>}
        <div className="flex items-end gap-2 rounded-xl border border-edge bg-panel px-3 py-2 transition-all duration-200 focus-within:border-accent/70 focus-within:shadow-[0_0_0_1px_rgba(217,119,87,0.3),0_4px_24px_rgba(217,119,87,0.08)]">
          <textarea
            ref={textareaRef}
            className="max-h-44 flex-1 resize-none bg-transparent text-[14px] leading-relaxed text-ink placeholder:text-muted focus:outline-none"
            rows={1}
            placeholder={running ? "Agent is working… you can stop it below" : 'Ask utcode to build, fix or explain something… (Enter to send)'}
            value={text}
            disabled={running}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {running ? (
            <button className="btn bg-red-500/15 text-red-300 hover:bg-red-500/25" onClick={() => void stop()} title="Stop agent (Esc)">
              <Square className="h-4 w-4" /> Stop
            </button>
          ) : (
            <button className="btn-primary !px-2.5" onClick={submit} disabled={!text.trim() || !!blocked} title="Send">
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <ComposerModelPicker />
          <RouterModeChip />
          <span className="ml-auto hidden shrink-0 text-xs text-muted md:inline">
            Enter to send · Shift+Enter newline · Esc to stop
          </span>
        </div>
      </div>
    </div>
  );
}
