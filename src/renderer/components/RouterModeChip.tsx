import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Gauge, PowerOff, Zap } from "lucide-react";
import type { RouterMode, RouterSettings } from "../../shared/types";
import { useSettingsStore } from "../stores/settingsStore";
import { clsx } from "../stores/api";

export function RouterModeChip() {
  const { settings, patchSettings } = useSettingsStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = settings?.router;
  const mode: RouterMode = router?.mode ?? "auto";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const tierName = (t: 1 | 2 | 3): string => {
    const cfg = router?.tiers[t];
    if (!cfg?.providerId) return "default provider";
    return settings?.providers.find((p) => p.id === cfg.providerId)?.name ?? "default provider";
  };

  const options: { value: RouterMode; label: string; sub: string }[] = [
    { value: "auto", label: "Auto-route", sub: "picks a tier per task" },
    { value: "tier1", label: "Tier 1 · Fast/Cheap", sub: tierName(1) },
    { value: "tier2", label: "Tier 2 · Balanced", sub: tierName(2) },
    { value: "tier3", label: "Tier 3 · Heavy Reasoning", sub: tierName(3) }
  ];
  const off = mode === "off";
  const current = off ? { value: "off" as RouterMode, label: "Router off", sub: "always use default provider" } : options.find((o) => o.value === mode) ?? options[0];

  const setMode = (m: RouterMode): void => {
    const nextRouter: RouterSettings = {
      mode: m,
      tiers: router?.tiers ?? {
        1: { providerId: null, model: "", priceInUsd: 0, priceOutUsd: 0 },
        2: { providerId: null, model: "", priceInUsd: 3, priceOutUsd: 15 },
        3: { providerId: null, model: "", priceInUsd: 15, priceOutUsd: 60 }
      }
    };
    void patchSettings({ router: nextRouter });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        className={clsx(
          "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] transition-all duration-200",
          off ? "border-edge bg-panel text-muted hover:text-ink" : "border-edge bg-panel text-ink/80 hover:border-accent/60 hover:text-ink hover:shadow-[0_0_12px_rgba(217,119,87,0.12)]"
        )}
        onClick={() => setOpen((v) => !v)}
        title="Model router: choose a tier manually, let utcode classify each task, or switch the router off"
      >
        {off ? <PowerOff className="h-3 w-3 text-muted" /> : mode === "auto" ? <Zap className="h-3 w-3 text-accent" /> : <Gauge className="h-3 w-3 text-accent" />}
        {off ? "Router off" : current.value === "auto" ? "Auto-route" : current.label.split(" · ")[0]}
        <span className="text-muted">· {off ? "static model" : current.value === "auto" ? "smart" : current.sub}</span>
        <ChevronDown className={clsx("h-3 w-3 text-muted transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute bottom-7 left-0 z-40 w-64 overflow-hidden rounded-lg border border-edge bg-[#1a1a1a] py-1 shadow-[0_16px_48px_rgba(0,0,0,0.6)]">
          <button
            className="flex w-full items-center gap-2 border-b border-edge px-3 py-2.5 text-left transition-colors duration-200 hover:bg-panel2"
            onClick={() => setMode(off ? "auto" : "off")}
            title="Toggle the model router on or off"
          >
            <span className="flex-1 text-xs font-medium text-ink">Model router</span>
            <span className={clsx("relative h-4 w-8 rounded-full transition-colors duration-200", off ? "bg-panel2" : "bg-accent")}>
              <span className={clsx("absolute top-[2px] h-3 w-3 rounded-full bg-white transition-all duration-200", off ? "left-[2px]" : "left-[18px]")} />
            </span>
            <span className="w-7 text-right text-[10px] text-muted">{off ? "OFF" : "ON"}</span>
          </button>
          {!off &&
            options.map((o) => (
              <button
                key={o.value}
                className={clsx(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors duration-200 hover:bg-panel2",
                  mode === o.value ? "text-accent" : "text-ink/85"
                )}
                onClick={() => {
                  setMode(o.value);
                  setOpen(false);
                }}
              >
                <span className="w-4">{mode === o.value && <Check className="h-3.5 w-3.5" />}</span>
                <span className="flex-1">
                  <span className="block font-medium">{o.label}</span>
                  <span className="block text-[10px] text-muted">{o.sub}</span>
                </span>
              </button>
            ))}
          {off && <div className="px-3 py-2 text-[10px] leading-relaxed text-muted">Router is off — every task uses your default provider and model directly, with no tier classification.</div>}
          {!off && (
            <div className="border-t border-edge px-3 py-1.5 text-[10px] leading-relaxed text-muted">
              Auto-classifies each task before the model call. Tier providers are assigned in Settings → Router.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
