import { useEffect, useState } from "react";
import { Check, GitMerge, Loader2, X } from "lucide-react";
import type { MergeComparison } from "../../shared/types";
import { api, call, clsx, errMsg } from "../stores/api";

interface Props {
  runA: string;
  titleA: string;
  candidates: { chatId: string; runId: string; title: string }[];
  onClose(): void;
}

export function MergeDialog({ runA, titleA, candidates, onClose }: Props) {
  const [runB, setRunB] = useState(candidates[0]?.runId ?? "");
  const [data, setData] = useState<MergeComparison | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runB) return;
    setData(null);
    setError(null);
    void call(api.utcode.mergeList(runA, runB)).then(setData).catch((e) => setError(errMsg(e)));
  }, [runA, runB]);

  const take = async (path: string, source: "a" | "b"): Promise<void> => {
    setBusy(`${path}:${source}`);
    setError(null);
    try {
      await call(api.utcode.mergeApply(source === "a" ? runA : runB, path));
      setApplied((prev) => ({ ...prev, [path]: source }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[75vh] w-[720px] max-w-full flex-col overflow-hidden rounded-2xl border border-edge bg-canvas shadow-[0_24px_80px_rgba(0,0,0,0.6)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <GitMerge className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold text-ink">Merge parallel tasks</span>
          <select className="input ml-auto !w-72 !py-1 text-xs" value={runB} onChange={(e) => setRunB(e.target.value)}>
            <option value="">choose the other finished task…</option>
            {candidates.map((c) => (
              <option key={c.runId} value={c.runId}>{c.title}</option>
            ))}
          </select>
          <button className="rounded p-1 text-muted hover:text-ink" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 pt-2 text-[11px] text-muted">
          Task A = <span className="text-accent">{titleA}</span> · Task B = the selection. Pick which version of each file to keep. Files edited by both are the real merge decisions.
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && <div className="mb-2 rounded bg-red-950/40 px-2 py-1 text-xs text-red-300">{error}</div>}
          {!runB && <div className="py-8 text-center text-sm text-muted">Select the second finished task to compare.</div>}
          {runB && !data && !error && <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> comparing changed files…</div>}
          {data && data.files.length === 0 && <div className="py-8 text-center text-sm text-muted">Neither task changed any files.</div>}
          {data && data.files.length > 0 && (
            <div className="space-y-2">
              {data.files.map((f) => {
                const conflict = f.a && f.b;
                const done = applied[f.path];
                return (
                  <div key={f.path} className={clsx("rounded-xl border p-3", done ? "border-emerald-500/40 bg-emerald-950/10" : conflict ? "border-accent/50" : "border-edge")}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{f.path}</span>
                      {conflict && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent">both edited · merge me</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                      {f.a && <span>A · {f.a.edits} edit(s){f.a.before === null ? " (created)" : ""}</span>}
                      {f.b && <span>B · {f.b.edits} edit(s){f.b.before === null ? " (created)" : ""}</span>}
                      <div className="ml-auto flex gap-1.5">
                        {f.a && (
                          <button className="btn-ghost !px-2.5 !py-1 text-[11px] disabled:opacity-40" disabled={busy !== null} onClick={() => void take(f.path, "a")}>
                            {done === "a" ? <Check className="h-3 w-3 text-emerald-400" /> : null} Take A
                          </button>
                        )}
                        {f.b && (
                          <button className="btn-ghost !px-2.5 !py-1 text-[11px] disabled:opacity-40" disabled={busy !== null} onClick={() => void take(f.path, "b")}>
                            {done === "b" ? <Check className="h-3 w-3 text-emerald-400" /> : null} Take B
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-edge px-4 py-2.5">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
