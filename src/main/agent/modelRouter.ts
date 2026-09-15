import type { ProviderConfig, RouterSettings, RouterTier } from "../../shared/types";

export interface RoutingDecision {
  tier: RouterTier;
  providerId: string | null;
  providerName: string | null;
  model: string;
  priceInUsd: number;
  priceOutUsd: number;
  autoClassified: boolean;
  reason: string;
}

export const TIER_LABELS: Record<RouterTier, string> = {
  1: "Fast/Cheap",
  2: "Balanced",
  3: "Heavy Reasoning"
};

const HEAVY_SIGNALS = [
  "architecture",
  "redesign",
  "restructure",
  "migration",
  "migrate",
  "distributed",
  "concurrency",
  "race condition",
  "deadlock",
  "memory leak",
  "memory corruption",
  "optimize",
  "performance",
  "profiling",
  "algorithm",
  "complex",
  "tricky",
  "crashing",
  "crash",
  "infinite loop",
  "hard to reproduce",
  "security",
  "encryption",
  "auth",
  "vulnerab",
  "database schema",
  "refactor",
  "debug",
  "fix the bug",
  "broken",
  "not working",
  "throws",
  "error after",
  "entire project",
  "end to end",
  "production ready"
];

const SIMPLE_SIGNALS = [
  "what does",
  "explain",
  "find ",
  "search for",
  "where is",
  "where are",
  "show me",
  "list ",
  "read ",
  "rename",
  "typo",
  "comment",
  "format",
  "print",
  "summarize",
  "open ",
  "look up"
];

const MULTI_FILE_SIGNALS = ["across", "all files", "every file", "multiple files", "whole codebase", "entire codebase"];

const FILE_REF_RE = /[\w./-]+\.(tsx?|jsx?|py|json|css|html|md|rs|go|java|c|cpp)\b/gi;

export function classifyTask(task: string): { tier: RouterTier; reason: string } {
  const t = task.toLowerCase();
  let score = 0;
  const hits: string[] = [];

  for (const signal of HEAVY_SIGNALS) {
    if (t.includes(signal)) {
      score += 2;
      hits.push(signal);
    }
  }
  const fileRefs = (task.match(FILE_REF_RE) ?? []).length;
  if (fileRefs >= 2) {
    score += 2;
    hits.push(`${fileRefs} file references`);
  }
  if (MULTI_FILE_SIGNALS.some((s) => t.includes(s))) {
    score += 2;
    hits.push("multi-file scope");
  }
  if (t.length > 600) {
    score += 1;
    hits.push("long detailed task");
  }
  const simpleHit = SIMPLE_SIGNALS.some((s) => t.includes(s));
  if (simpleHit && fileRefs <= 1 && t.length < 200 && score < 2) {
    score -= 3;
  }

  const tier: RouterTier = score >= 5 ? 3 : score >= 1 ? 2 : 1;
  const detail = hits.length > 0 ? hits.slice(0, 3).join(", ") : "short, focused request";
  const reason =
    tier === 3
      ? `complex work detected (${detail})`
      : tier === 2
        ? `moderate edits / logic changes (${detail})`
        : `quick lookup or small change (${detail})`;
  return { tier, reason };
}

export function decideRoute(router: RouterSettings, providers: ProviderConfig[], task: string): RoutingDecision | null {
  if (router.mode === "off") return null;
  const manual = router.mode !== "auto";
  const cls = manual
    ? { tier: Number(router.mode.slice(4)) as RouterTier, reason: `manual override: Tier ${router.mode.slice(4)}` }
    : classifyTask(task);
  const tier = (cls.tier === 1 || cls.tier === 2 || cls.tier === 3 ? cls.tier : 2) as RouterTier;
  const cfg = router.tiers?.[tier] ?? { providerId: null, model: "", priceInUsd: 0, priceOutUsd: 0 };
  const provider = cfg.providerId ? providers.find((p) => p.id === cfg.providerId && p.enabled) ?? null : null;
  const model = cfg.model.trim().length > 0 ? cfg.model.trim() : provider?.model ?? "";

  let reason: string;
  if (provider) {
    reason = `Using Tier ${tier} (${TIER_LABELS[tier]}) — ${cls.reason} → ${provider.name} · ${model || "default model"}`;
  } else {
    reason = `Using Tier ${tier} (${TIER_LABELS[tier]}) — ${cls.reason}. No provider assigned yet, falling back to your default provider (assign one in Settings → Model Router).`;
  }

  return {
    tier,
    providerId: provider?.id ?? null,
    providerName: provider?.name ?? null,
    model,
    priceInUsd: cfg.priceInUsd || 0,
    priceOutUsd: cfg.priceOutUsd || 0,
    autoClassified: !manual,
    reason
  };
}

export function estimateCostUsd(promptTokens: number, completionTokens: number, priceInUsd: number, priceOutUsd: number): number {
  return (promptTokens * priceInUsd + completionTokens * priceOutUsd) / 1_000_000;
}
