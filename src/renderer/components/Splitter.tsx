import { useRef } from "react";

interface SplitterProps {
  getValue: () => number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  onReset?: () => void;
  invert?: boolean;
  title?: string;
}

export function Splitter({ getValue, onChange, onCommit, onReset, invert, title }: SplitterProps) {
  const dragging = useRef(false);
  const startVal = useRef(0);
  const startX = useRef(0);
  const pending = useRef(0);
  const rafId = useRef<number | null>(null);

  const begin = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    startVal.current = getValue();
    startX.current = e.clientX;
    pending.current = startVal.current;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (ev: PointerEvent): void => {
      if (!dragging.current) return;
      const delta = ev.clientX - startX.current;
      pending.current = startVal.current + (invert ? -delta : delta);
      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(() => {
          rafId.current = null;
          if (dragging.current) onChange(pending.current);
        });
      }
    };
    const end = (): void => {
      dragging.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      onChange(pending.current);
      onCommit(pending.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title={title ?? "Drag to resize · double-click to reset"}
      className="group relative z-20 w-[6px] shrink-0 cursor-col-resize bg-transparent"
      onPointerDown={begin}
      onDoubleClick={onReset}
    >
      <div className="pointer-events-none absolute inset-y-0 left-[2px] w-[2px] rounded bg-edge transition-colors duration-100 group-hover:bg-accent/70" />
    </div>
  );
}
