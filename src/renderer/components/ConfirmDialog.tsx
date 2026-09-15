import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  title?: string;
  body: string;
  confirmLabel?: string;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({ open, title = "Are you sure?", body, confirmLabel = "Delete", onConfirm, onCancel }: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[420px] max-w-full rounded-2xl border border-edge bg-[#1a1a1a] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/15 text-red-400">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
        </div>
        <p className="mb-5 pl-10 text-[13px] leading-relaxed text-muted">{body}</p>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn bg-red-500/90 text-white hover:bg-red-500"
            onClick={() => {
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
