import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import { clsx } from "../stores/api";

export function ComposerModelPicker() {
  const { providers, settings, setActiveProvider, selectModel, recentModels, recordRecentModel } = useSettingsStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const enabled = providers.filter((p) => p.enabled);
  const activeId = settings?.activeProviderId ?? settings?.defaultProviderId ?? null;
  const active = enabled.find((p) => p.id === activeId) ?? enabled[0];

  const q = query.trim().toLowerCase();
  const recent = useMemo(
    () =>
      recentModels
        .map((r) => ({ ...r, provider: enabled.find((p) => p.id === r.providerId) }))
        .filter((r) => !!r.provider)
        .slice(0, 5),
    [recentModels, enabled]
  );
  const rows = useMemo(() => {
    const out: { providerId: string; providerName: string; model: string; isCurrent: boolean; isSaved: boolean }[] = [];
    for (const p of enabled) {
      const models = new Set<string>();
      models.add(p.model);
      for (const m of p.availableModels ?? []) models.add(m);
      for (const m of models) {
        if (q && !(p.name.toLowerCase().includes(q) || m.toLowerCase().includes(q))) continue;
        out.push({
          providerId: p.id,
          providerName: p.name,
          model: m,
          isCurrent: p.id === active?.id && m === active?.model,
          isSaved: m === p.model
        });
      }
    }
    return out.slice(0, 160);
  }, [enabled, q, active]);

  if (enabled.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        className="flex items-center gap-1.5 rounded-full border border-edge bg-panel px-3 py-1 text-[11px] text-ink/80 transition-all duration-200 hover:border-accent/60 hover:text-ink hover:shadow-[0_0_12px_rgba(217,119,87,0.12)]"
        onClick={() => setOpen((v) => !v)}
        title="Change the AI model (search supported)"
      >
        <span className="max-w-[180px] truncate font-mono">
          {active ? `${active.name} · ${active.model}` : "no provider"}
        </span>
        <ChevronDown className={clsx("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute bottom-7 left-0 z-40 flex max-h-80 w-80 flex-col overflow-hidden rounded-lg border border-edge bg-panel shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-edge px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted" />
            <input
              autoFocus
              className="w-full bg-transparent text-xs text-ink placeholder:text-muted focus:outline-none"
              placeholder="Search providers and models…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {recent.length > 0 && (
              <>
                <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted/60">Recent</div>
                {recent.map((r) => {
                  const isCurrent = r.providerId === active?.id && r.model === active?.model;
                  return (
                    <button
                      key={`recent-${r.providerId}|${r.model}`}
                      className={clsx(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-200 hover:bg-panel2",
                        isCurrent ? "text-accent" : "text-ink/85"
                      )}
                      onClick={() => {
                        recordRecentModel(r.providerId, r.model);
                        if (!isCurrent) void selectModel(r.providerId, r.model);
                        setOpen(false);
                      }}
                    >
                      <span className="w-5 shrink-0">{isCurrent && <Check className="h-3.5 w-3.5" />}</span>
                      <span className="shrink-0 font-medium">{r.provider?.name}</span>
                      <span className="truncate font-mono text-[11px] text-muted">{r.model}</span>
                    </button>
                  );
                })}
                <div className="my-1 border-t border-edge/60" />
              </>
            )}
            {rows.length === 0 && <div className="px-3 py-2 text-xs text-muted">No matches. Try "Fetch models" in Settings for this provider.</div>}
            {rows.map((r) => (
              <button
                key={`${r.providerId}|${r.model}`}
                className={clsx(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-panel2",
                  r.isCurrent ? "text-accent" : "text-ink/85"
                )}
                onClick={() => {
                  recordRecentModel(r.providerId, r.model);
                  if (r.isCurrent) {
                    setOpen(false);
                    return;
                  }
                  if (r.isSaved && r.providerId !== active?.id) void setActiveProvider(r.providerId);
                  else void selectModel(r.providerId, r.model);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="w-5 shrink-0">{r.isCurrent && <Check className="h-3.5 w-3.5" />}</span>
                <span className="shrink-0 font-medium">{r.providerName}</span>
                <span className="truncate font-mono text-[11px] text-muted">{r.model}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-edge px-3 py-1.5 text-[10px] text-muted">
            Selecting a model switches the active provider too. Longer lists: use Fetch models in Settings.
          </div>
        </div>
      )}
    </div>
  );
}
