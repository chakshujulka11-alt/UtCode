import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { ChatMessage } from "../../shared/types";
import { MessageBubble } from "./MessageBubble";

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = boxRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const onScroll = (): void => {
    const el = boxRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = dist < 50;
    atBottomRef.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  };

  useEffect(() => {
    if (atBottomRef.current) {
      const el = boxRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={boxRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.map((m) => (
            <MessageItem key={m.id} message={m} />
          ))}
        </div>
      </div>
      {!atBottom && (
        <button
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-edge bg-panel px-3.5 py-1.5 text-xs text-ink shadow-[0_8px_24px_rgba(0,0,0,0.5)] transition-colors duration-200 hover:border-accent/60 hover:text-accent"
          onClick={() => scrollToBottom()}
        >
          <ArrowDown className="h-3.5 w-3.5" /> Jump to bottom
        </button>
      )}
    </div>
  );
}

function MessageItem({ message }: { message: ChatMessage }) {
  return <MessageBubble message={message} />;
}
