import { describe, expect, it } from "vitest";
import { classifyTask, decideRoute, estimateCostUsd, TIER_LABELS } from "../src/main/agent/modelRouter";
import type { ProviderConfig, RouterSettings } from "../src/shared/types";

const router = (overrides?: Partial<RouterSettings>): RouterSettings => ({
  mode: "auto",
  tiers: {
    1: { providerId: null, model: "", priceInUsd: 0, priceOutUsd: 0 },
    2: { providerId: null, model: "", priceInUsd: 3, priceOutUsd: 15 },
    3: { providerId: null, model: "", priceInUsd: 15, priceOutUsd: 60 }
  },
  ...overrides
});

const providers: ProviderConfig[] = [
  { id: "p1", name: "Ollama", type: "openai-compatible", model: "qwen2.5-coder", baseUrl: "http://localhost:11434/v1", enabled: true },
  { id: "p2", name: "OpenAI", type: "openai", model: "gpt-4o", enabled: true },
  { id: "p3", name: "Anthropic", type: "anthropic", model: "claude-opus", enabled: false }
];

describe("classifyTask", () => {
  it("routes quick lookups to Tier 1", () => {
    expect(classifyTask("read src/app.ts and tell me what it does").tier).toBe(1);
    expect(classifyTask("rename getU to getUser in utils.ts").tier).toBe(1);
    expect(classifyTask("search for TODO comments").tier).toBe(1);
  });

  it("routes multi-file feature work to Tier 2", () => {
    expect(classifyTask("add a dark mode toggle to Settings.tsx and ThemeProvider.tsx").tier).toBe(2);
  });

  it("routes architecture / gnarly debugging to Tier 3", () => {
    expect(classifyTask("refactor auth across all files").tier).toBe(3);
    expect(classifyTask("debug the race condition causing memory leaks in the worker pool").tier).toBe(3);
    expect(classifyTask("redesign the database schema for the entire project and migrate it").tier).toBe(3);
  });

  it("always returns a reason string", () => {
    expect(classifyTask("do something").reason.length).toBeGreaterThan(0);
  });
});

describe("decideRoute", () => {
  it("auto mode uses the tier mapping when a provider is assigned", () => {
    const r = router({ tiers: { ...router().tiers, 2: { providerId: "p2", model: "", priceInUsd: 2.5, priceOutUsd: 10 } } });
    const d = decideRoute(r, providers, "add a dark mode toggle to Settings.tsx and ThemeProvider.tsx")!;
    expect(d.tier).toBe(2);
    expect(d.providerId).toBe("p2");
    expect(d.model).toBe("gpt-4o");
    expect(d.autoClassified).toBe(true);
    expect(d.reason).toContain("Tier 2");
    expect(d.reason).toContain("OpenAI");
  });

  it("manual pin overrides the heuristic", () => {
    const d = decideRoute(router({ mode: "tier3" }), providers, "what does index.js do?")!;
    expect(d.tier).toBe(3);
    expect(d.autoClassified).toBe(false);
    expect(d.reason).toContain("manual override");
  });

  it("falls back to the default provider when a tier is unassigned", () => {
    const d = decideRoute(router(), providers, "read src/app.ts and tell me what it does")!;
    expect(d.providerId).toBeNull()!;
    expect(d.reason).toContain("falling back");
  });

  it("returns null when the router is switched off", () => {
    const d = decideRoute(router({ mode: "off" }), providers, "refactor auth across all files");
    expect(d).toBeNull();
  });

  it("ignores disabled providers assigned to a tier", () => {
    const r = router({ tiers: { ...router().tiers, 1: { providerId: "p3", model: "", priceInUsd: 0, priceOutUsd: 0 } } });
    const d = decideRoute(r, providers, "list files in src")!;
    expect(d.providerId).toBeNull();
  });

  it("respects a tier model override", () => {
    const r = router({ tiers: { ...router().tiers, 2: { providerId: "p1", model: "llama3.1:70b", priceInUsd: 0, priceOutUsd: 0 } } });
    const d = decideRoute(r, providers, "add tests to api.ts and server.ts")!;
    expect(d.model).toBe("llama3.1:70b");
  });
});

describe("estimateCostUsd", () => {
  it("computes per-million pricing", () => {
    expect(estimateCostUsd(1_000_000, 1_000_000, 3, 15)).toBe(18);
    expect(estimateCostUsd(500_000, 0, 2, 10)).toBe(1);
    expect(estimateCostUsd(1000, 1000, 0, 0)).toBe(0);
  });
});

describe("TIER_LABELS", () => {
  it("has all three tiers", () => {
    expect(TIER_LABELS[1]).toContain("Fast");
    expect(TIER_LABELS[3]).toContain("Heavy");
  });
});
