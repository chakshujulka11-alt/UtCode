import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Github,
  HelpCircle,
  Bug,
  Loader2,
  Plus,
  Plug,
  RefreshCw,
  RotateCcw,
  Settings2,
  Star,
  Trash2,
  X
} from "lucide-react";
import { DEFAULT_AGENT_SETTINGS, GITHUB_REPO } from "../../shared/constants";
import type { AgentSettings, ProviderConfig, ProviderInput, ProviderType, RouterTierConfig } from "../../shared/types";
import { useSettingsStore } from "../stores/settingsStore";
import { THEME_PRESETS } from "../theme";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { api, call, clsx } from "../stores/api";
import { UtcodeBrand } from "./UtcodeBrand";
import { ModelPicker } from "./ModelPicker";

const SECTIONS = ["Providers", "Router", "Vector", "MCP", "Agent", "Appearance", "Workspace", "About"] as const;
type Section = (typeof SECTIONS)[number];

interface ProviderPreset {
  label: string;
  type: ProviderType;
  baseUrl: string;
  model: string;
  needsKey: boolean;
}

const PRESETS: ProviderPreset[] = [
  { label: "OpenAI", type: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o", needsKey: true },
  { label: "Anthropic", type: "anthropic", baseUrl: "", model: "claude-sonnet-4-20250514", needsKey: true },
  { label: "Google Gemini", type: "gemini", baseUrl: "", model: "gemini-2.5-flash", needsKey: true },
  { label: "OpenRouter", type: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4", needsKey: true },
  { label: "Groq", type: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", needsKey: true },
  { label: "Together", type: "openai-compatible", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", needsKey: true },
  { label: "DeepSeek", type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", needsKey: true },
  { label: "Ollama (local)", type: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "qwen2.5-coder:32b", needsKey: false },
  { label: "LM Studio (local)", type: "openai-compatible", baseUrl: "http://localhost:1234/v1", model: "local-model", needsKey: false },
  { label: "Custom compatible", type: "openai-compatible", baseUrl: "", model: "", needsKey: false }
];

interface DraftProvider extends ProviderInput {
  apiKeyDraft?: string;
  isNew?: boolean;
  apiKeyPresent?: boolean;
  apiKeyMasked?: string;
}

function ProvidersSection() {
  const { providers, settings, tests, modelFetch, saveProvider, deleteProvider, testProvider, fetchModels, setDefault, favorites, toggleFavorite } = useSettingsStore();
  const [draft, setDraft] = useState<DraftProvider | null>(null);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const startNew = (preset: ProviderPreset): void => {
    setFormError(null);
    setDraft({
      id: `p-${Date.now().toString(36)}`,
      name: preset.label,
      type: preset.type,
      model: preset.model,
      baseUrl: preset.baseUrl,
      enabled: true,
      isNew: true,
      apiKeyDraft: ""
    });
  };

  const edit = (p: ProviderConfig): void => {
    setFormError(null);
    setDraft({
      id: p.id,
      name: p.name,
      type: p.type,
      model: p.model,
      baseUrl: p.baseUrl,
      enabled: p.enabled,
      availableModels: p.availableModels,
      apiKeyDraft: "",
      apiKeyPresent: p.apiKeyPresent,
      apiKeyMasked: p.apiKeyMasked,
      isNew: false
    });
  };

  const save = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    setFormError(null);
    const ok = await saveProvider({
      id: draft.id,
      name: draft.name.trim(),
      type: draft.type,
      model: draft.model.trim(),
      baseUrl: draft.baseUrl?.trim() || undefined,
      enabled: draft.enabled,
      apiKey: draft.apiKeyDraft && draft.apiKeyDraft.length > 0 ? draft.apiKeyDraft : undefined
    });
    setSaving(false);
    if (ok) setDraft(null);
    else setFormError(useSettingsStore.getState().error);
  };

  return (
    <div className="grid gap-6 md:grid-cols-[240px_1fr]">
      <div>
        <div className="label">Add provider</div>
        <div className="space-y-1">
          {PRESETS.map((preset) => (
            <button key={preset.label} className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-[13px] text-ink/85 transition-colors duration-200 hover:border-edge hover:bg-panel2" onClick={() => startNew(preset)}>
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15">
                <Plus className="h-2.5 w-2.5 text-accent" />
              </span>
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        {providers.length === 0 && !draft && (
          <div className="rounded-lg border border-dashed border-edge p-6 text-center text-sm text-muted">
            No providers yet. Pick one on the left — cloud or local (Ollama / LM Studio) both work.
          </div>
        )}
        {providers.length > 0 && (
          <div className="mb-4 space-y-2">
            {providers.map((p) => {
              const t = tests[p.id];
              const isDefault = settings?.defaultProviderId === p.id;
              return (
                <div key={p.id} className={clsx("rounded-xl border p-4 transition-colors duration-200", isDefault ? "border-accent/60 bg-accent/[0.06] shadow-[0_0_24px_-6px_rgba(217,119,87,0.35)]" : "border-edge bg-panel2/30")}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{p.name}</span>
                    <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">{p.type}</span>
                    {isDefault && (
                      <span className="flex items-center gap-0.5 text-[11px] text-accent">
                        <Star className="h-3 w-3" /> default
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      <button className={clsx("rounded p-1 text-xs", p.enabled ? "text-emerald-400" : "text-muted")} title={p.enabled ? "Enabled — click to disable" : "Disabled — click to enable"} onClick={() => void saveProvider({ id: p.id, name: p.name, type: p.type, model: p.model, baseUrl: p.baseUrl, enabled: !p.enabled })}>
                        {p.enabled ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                      </button>
                      {!isDefault && (
                        <button className="rounded p-1 text-muted hover:text-accent" title="Set as default" onClick={() => void setDefault(p.id)}>
                          <Star className="h-4 w-4" />
                        </button>
                      )}
                      <button className="rounded p-1 text-muted hover:text-ink" title="Edit" onClick={() => edit(p)}>
                        <Settings2 className="h-4 w-4" />
                      </button>
                      <button className="rounded p-1 text-muted hover:text-red-400" title="Delete" onClick={() => void deleteProvider(p.id)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                    <span>model: <span className="font-mono text-ink/80">{p.model}</span></span>
                    {p.baseUrl && <span>url: <span className="font-mono text-ink/80">{p.baseUrl}</span></span>}
                    <span>key: {p.apiKeyPresent ? <span className="font-mono text-ink/80">{p.apiKeyMasked ?? "••••••"}</span> : <span className="text-amber-400/90">not set</span>}</span>
                    <div className="ml-auto flex items-center gap-1">
                      <div className="w-56">
                        <ModelPicker
                          models={[...new Set([...(p.availableModels ?? []), p.model])]}
                          value={p.model}
                          favorites={favorites}
                          onToggleFavorite={toggleFavorite}
                          onChange={(model) =>
                            void saveProvider({ id: p.id, name: p.name, type: p.type, model, baseUrl: p.baseUrl, enabled: p.enabled, availableModels: p.availableModels })
                          }
                        />
                      </div>
                      <button
                        className="btn-ghost !border-edge !bg-panel2/60 !px-2.5 !py-1 text-[11px]"
                        disabled={modelFetch[p.id]?.pending}
                        title="Ask the provider for its model list (requires a valid key/endpoint)"
                        onClick={() => void fetchModels(p.id)}
                      >
                        {modelFetch[p.id]?.pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3 text-accent" />}
                        Fetch models
                      </button>
                      <button
                        className="btn-ghost !border-edge !bg-panel2/60 !px-2.5 !py-1 text-[11px]"
                        onClick={() => void testProvider(p.id)}
                        disabled={t?.pending}
                      >
                        {t?.pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3 text-accent" />} Test connection
                      </button>
                    </div>
                  </div>
                  {modelFetch[p.id]?.error && <div className="mt-2 rounded bg-red-950/40 px-2 py-1 text-xs text-red-300">{modelFetch[p.id]?.error}</div>}
                  {modelFetch[p.id] && !modelFetch[p.id]?.pending && !modelFetch[p.id]?.error && (
                    <div className="mt-1 text-xs text-emerald-400">{modelFetch[p.id]?.count} model(s) fetched — pick one above.</div>
                  )}
                  {t && !t.pending && (
                    <div className={clsx("mt-2 rounded px-2 py-1 text-xs", t.ok ? "bg-emerald-950/40 text-emerald-300" : "bg-red-950/40 text-red-300")}>
                      {t.ok ? `OK (${t.latencyMs ?? "?"} ms)${t.models?.length ? ` · ${t.models.length} model(s) visible` : ""}` : t.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {draft && (
          <div className="rounded-lg border border-accent/50 bg-panel2/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">{draft.isNew ? "New provider" : `Edit ${draft.name}`}</h3>
              <button className="rounded p-1 text-muted hover:text-ink" onClick={() => setDraft(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Display name</label>
                <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Type</label>
                <select className="input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as ProviderType })}>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="openai-compatible">OpenAI-compatible</option>
                </select>
              </div>
              <div>
                <label className="label">Model</label>
                <div className="flex items-center gap-1.5">
                  {draft.availableModels && draft.availableModels.length > 0 ? (
                    <div className="min-w-0 flex-1">
                      <ModelPicker
                        models={[...new Set([...draft.availableModels, draft.model])]}
                        value={draft.model}
                        favorites={favorites}
                        onToggleFavorite={toggleFavorite}
                        placeholder="Pick a model (searchable)…"
                        onChange={(m) => setDraft({ ...draft, model: m })}
                      />
                    </div>
                  ) : (
                    <input
                      className="input font-mono flex-1"
                      value={draft.model}
                      placeholder={draft.isNew ? "gpt-4o — or save, then Fetch models" : "type a model name (fetch models to pick from a list)"}
                      onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                    />
                  )}
                  {!draft.isNew && (
                    <button
                      className="btn-ghost shrink-0 !px-2 !py-1 text-[11px]"
                      disabled={modelFetch[draft.id]?.pending}
                      onClick={async () => {
                        const list = await fetchModels(draft.id);
                        if (list.length > 0) setDraft((d) => (d ? { ...d, availableModels: list } : d));
                      }}
                    >
                      {modelFetch[draft.id]?.pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Fetch
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="label">Base URL {draft.type === "openai-compatible" ? "(required)" : "(optional)"}</label>
                <input className="input font-mono" value={draft.baseUrl ?? ""} placeholder="http://localhost:11434/v1" onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">API key {draft.isNew ? "" : "(leave empty to keep current)"} — stored encrypted via Windows credential storage</label>
                <div className="relative">
                  <input
                    className="input pr-9 font-mono"
                    type={showKey ? "text" : "password"}
                    value={draft.apiKeyDraft ?? ""}
                    placeholder={draft.apiKeyPresent ? `stored (${draft.apiKeyMasked})` : "sk-…"}
                    onChange={(e) => setDraft({ ...draft, apiKeyDraft: e.target.value })}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition-colors duration-200 hover:text-ink"
                    title={showKey ? "Hide API key" : "Reveal API key"}
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
            {formError && <div className="mt-2 rounded bg-red-950/40 px-2 py-1 text-xs text-red-300">{formError}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn-primary" disabled={saving} onClick={() => void save()}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save provider
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RouterSection() {
  const { settings, providers, patchSettings } = useSettingsStore();
  const router = settings?.router;
  if (!router) return null;
  const enabled = providers.filter((p) => p.enabled);

  const setTier = (tier: 1 | 2 | 3, patch: Partial<RouterTierConfig>): void => {
    void patchSettings({
      router: { mode: router.mode, tiers: { ...router.tiers, [tier]: { ...router.tiers[tier], ...patch } } }
    });
  };

  const meta: { tier: 1 | 2 | 3; title: string; desc: string; examples: string }[] = [
    { tier: 1, title: "Tier 1 · Fast/Cheap", desc: "File reads, searches, small edits", examples: "e.g. Ollama local, gpt-4o-mini, Claude Haiku" },
    { tier: 2, title: "Tier 2 · Balanced", desc: "Multi-file edits, regular features & refactors", examples: "e.g. Claude Sonnet, GPT-4o" },
    { tier: 3, title: "Tier 3 · Heavy Reasoning", desc: "Architecture, complex debugging, migrations", examples: "e.g. o1, Claude Opus" }
  ];

  return (
    <div>
      <div className="mb-3 rounded-lg border border-accent/40 bg-accent/[0.06] p-3">
        <div className="text-sm font-medium text-ink">Intelligent Model Router</div>
        <div className="mt-0.5 text-xs leading-relaxed text-muted">
          In <span className="text-accent">Auto</span> mode utcode classifies every task before the model call and picks a tier
          (the chat timeline shows which model was chosen and why). Override the tier anytime with the chip in the composer.
          Tiers without a provider fall back to your default provider.
        </div>
        <div className="mt-2 flex gap-1.5">
          {(["off", "auto", "tier1", "tier2", "tier3"] as const).map((m) => (
            <button
              key={m}
              className={clsx("rounded-full border px-3 py-1 text-xs transition-colors duration-200", router.mode === m ? "border-accent bg-accent/15 text-accent" : "border-edge text-muted hover:text-ink")}
              onClick={() => void patchSettings({ router: { mode: m, tiers: router.tiers } })}
            >
              {m === "off" ? "Off" : m === "auto" ? "Auto" : `Pin ${m.replace("tier", "Tier ")}`}
            </button>
          ))}
        </div>
      </div>

      {enabled.length === 0 && <div className="mb-3 text-xs text-amber-400/90">No enabled providers yet — add one in the Providers tab first.</div>}

      <div className="space-y-3">
        {meta.map((row) => {
          const cfg = router.tiers[row.tier];
          return (
            <div key={row.tier} className="rounded-xl border border-edge bg-panel2/30 p-4">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-sm font-semibold text-ink">{row.title}</span>
                <span className="text-xs text-muted">{row.desc}</span>
                <span className="ml-auto text-[10px] text-muted">{row.examples}</span>
              </div>
              <div className="mt-2.5 grid gap-2 sm:grid-cols-4">
                <div>
                  <label className="label">Provider</label>
                  <select className="input" value={cfg.providerId ?? ""} onChange={(e) => setTier(row.tier, { providerId: e.target.value || null })}>
                    <option value="">Default (fallback)</option>
                    {enabled.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Model override</label>
                  <input className="input font-mono text-xs" value={cfg.model} placeholder="(provider default)" onChange={(e) => setTier(row.tier, { model: e.target.value })} />
                </div>
                <div>
                  <label className="label">$/1M in</label>
                  <input className="input font-mono text-xs" type="number" min={0} step={0.1} value={cfg.priceInUsd} onChange={(e) => setTier(row.tier, { priceInUsd: Math.max(0, Number(e.target.value) || 0) })} />
                </div>
                <div>
                  <label className="label">$/1M out</label>
                  <input className="input font-mono text-xs" type="number" min={0} step={0.1} value={cfg.priceOutUsd} onChange={(e) => setTier(row.tier, { priceOutUsd: Math.max(0, Number(e.target.value) || 0) })} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted">
        Prices are only used for the estimated cost shown in the status bar — set them to 0 for local models.
        If a provider does not report usage, utcode estimates tokens as ≈ characters ÷ 4.
      </p>
    </div>
  );
}

function IndexWorkspaceButton({ inline }: { inline?: boolean }) {
  const root = useWorkspaceStore((s) => s.root);
  const indexProgress = useSettingsStore((s) => s.indexProgress);
  const runVectorIndex = useSettingsStore((s) => s.runVectorIndex);
  if (!root) return null;
  return (
    <button className={clsx("btn-accent-ghost", inline && "mb-4")} disabled={indexProgress !== null} onClick={() => void runVectorIndex(false)}>
      {indexProgress ? `Indexing… ${indexProgress.done}/${indexProgress.total || "…"}` : "Index workspace (semantic search)"}
    </button>
  );
}

function VectorSection() {
  const { settings, providers, patchSettings, vectorStats, indexProgress, runVectorIndex } = useSettingsStore();
  const root = useWorkspaceStore((s) => s.root);
  const v = settings?.vector;
  if (!v) return null;
  const setV = (patch: Partial<typeof v>): void => void patchSettings({ vector: { ...v, ...patch } });
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-accent/40 bg-accent/[0.06] p-3">
        <div className="text-sm font-medium text-ink">Local RAG · semantic codebase memory</div>
        <div className="mt-1 text-xs leading-relaxed text-muted">
          utcode chunks every code file into a local index (<span className="font-mono">.utcode/vectors.json</span> — stays on your machine)
          so the agent can <span className="font-mono">semantic_search</span> for code <em>by meaning</em> instead of reading the tree.
          With an embedding provider configured it uses real embeddings; without one it automatically falls back to the built-in
          lexical embedding model, so it always works offline.
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" className="accent-[#d97757]" checked={v.enabled} onChange={(e) => setV({ enabled: e.target.checked })} />
        Enable workspace indexing & semantic_search tool
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Embedding provider (optional)</label>
          <select className="input" value={v.providerId ?? ""} onChange={(e) => setV({ providerId: e.target.value || null })}>
            <option value="">Auto (active provider / built-in lexical)</option>
            {providers.filter((p) => p.enabled).map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.baseUrl || p.type})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Embedding model</label>
          <input className="input font-mono text-xs" value={v.model} placeholder="nomic-embed-text" onChange={(e) => setV({ model: e.target.value })} />
          <div className="mt-1 text-[10px] text-muted">Ollama: nomic-embed-text · OpenAI: text-embedding-3-small</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-primary" disabled={!root || indexProgress !== null} onClick={() => void runVectorIndex(false)}>
          {indexProgress ? "Indexing…" : "Index workspace"}
        </button>
        <button className="btn-ghost" disabled={!root || indexProgress !== null} onClick={() => void runVectorIndex(true)}>
          Full rebuild
        </button>
        <div className="ml-auto text-right text-xs text-muted">
          {indexProgress ? (
            <span className="text-accent">⋯ {indexProgress.done}/{indexProgress.total || "…"} files</span>
          ) : vectorStats && vectorStats.chunks > 0 ? (
            <>{vectorStats.files} files · {vectorStats.chunks} chunks · <span className="font-mono">{vectorStats.backend}</span>
              {vectorStats.lastIndexedAt ? <span> · {new Date(vectorStats.lastIndexedAt).toLocaleTimeString()}</span> : null}
            </>
          ) : (
            "not indexed yet"
          )}
        </div>
      </div>
      <div className="rounded-lg border border-edge bg-panel2/30 p-3 text-[11px] leading-relaxed text-muted">
        Tip: run an embedding model locally with <span className="font-mono text-ink/80">ollama pull nomic-embed-text</span>, pick it
        above, and the whole codebase stays searchable without sending code anywhere.
      </div>
    </div>
  );
}

function McpSection() {
  const { mcp, mcpBusy, saveMcp, deleteMcp, connectMcp, disconnectMcp, importMcp, mcpTools } = useSettingsStore();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("npx");
  const [args, setArgs] = useState("-y @modelcontextprotocol/server-everything");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tools, setTools] = useState<{ name: string; description: string }[]>([]);

  useEffect(() => {
    if (!expanded) return;
    void callTools(expanded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  async function callTools(server: string): Promise<void> {
    try {
      const t = await mcpTools(server);
      setTools(t);
    } catch {
      setTools([]);
    }
  }

  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        MCP servers extend the agent with external tools. stdio servers configured here are started from your machine and run with their environment.
      </p>
      {mcp.length === 0 && <div className="mb-4 rounded-lg border border-dashed border-edge p-5 text-center text-sm text-muted">No MCP servers yet.</div>}
      <div className="mb-5 space-y-2">
        {mcp.map((s) => (
          <div key={s.name} className="rounded-lg border border-edge bg-panel2/40 p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink">{s.name}</span>
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                  s.status === "connected" && "bg-emerald-500/15 text-emerald-400",
                  s.status === "connecting" && "bg-amber-500/15 text-amber-400",
                  s.status === "error" && "bg-red-500/15 text-red-400",
                  s.status === "stopped" && "bg-panel2 text-muted"
                )}
              >
                {s.status}
              </span>
              <span className="text-xs text-muted">{s.toolCount} tool(s)</span>
              <div className="ml-auto flex gap-1">
                <button
                  className="btn-ghost !px-2 !py-0.5 text-[11px]"
                  disabled={mcpBusy === s.name}
                  onClick={() => void (s.status === "connected" ? disconnectMcp(s.name) : connectMcp(s.name))}
                >
                  {mcpBusy === s.name ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {s.status === "connected" ? "Disconnect" : "Connect"}
                </button>
                <button className="btn-ghost !px-2 !py-0.5 text-[11px]" onClick={() => setExpanded(expanded === s.name ? null : s.name)}>
                  Inspect
                </button>
                <button className="btn-ghost !px-2 !py-0.5 text-[11px] hover:!text-red-400" onClick={() => void deleteMcp(s.name)}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
            {s.error && <div className="mt-1 text-xs text-red-300">{s.error}</div>}
            {expanded === s.name && (
              <div className="mt-2 rounded bg-[#181818] p-2 font-mono text-[11px] text-ink/80">
                {tools.length === 0 ? <span className="text-muted">no tools discovered (connect first)</span> : tools.map((t) => `${t.name} — ${t.description.slice(0, 90)}`).join("\n")}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-edge p-3">
        <div className="label">Add MCP server (stdio)</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className="input bg-canvas font-mono transition-colors duration-200 focus:border-accent focus:ring-1 focus:ring-accent/60" placeholder="name (e.g. everything)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input bg-canvas font-mono transition-colors duration-200 focus:border-accent focus:ring-1 focus:ring-accent/60" placeholder="command (e.g. npx)" value={command} onChange={(e) => setCommand(e.target.value)} />
          <input className="input bg-canvas font-mono transition-colors duration-200 focus:border-accent focus:ring-1 focus:ring-accent/60" placeholder="args (space separated)" value={args} onChange={(e) => setArgs(e.target.value)} />
        </div>
        {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => void importMcp()}>
            <Download className="h-3.5 w-3.5" /> Import mcp_config.json
          </button>
          <button className="btn-primary !px-3 !py-1.5 text-xs"
            onClick={() => {
              setError(null);
              if (!name.trim()) {
                setError("Name is required.");
                return;
              }
              if (!command.trim()) {
                setError("Command is required.");
                return;
              }
              void (async () => {
                await saveMcp({
                  name: name.trim(),
                  command: command.trim(),
                  args: args.trim() ? args.trim().split(/\s+/) : []
                });
                const err = useSettingsStore.getState().error;
                if (err) setError(err);
                else {
                  setName("");
                  useSettingsStore.setState({ error: null });
                }
              })();
            }}
          >
            Add server
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1.5 inline-flex align-middle">
      <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted/70 transition-colors duration-200 hover:text-accent" />
      <span className="pointer-events-none absolute left-1/2 top-6 z-50 w-64 -translate-x-1/2 rounded-lg border border-edge bg-panel p-2.5 text-[11px] font-normal normal-case leading-snug tracking-normal text-ink opacity-0 shadow-[0_12px_36px_rgba(0,0,0,0.6)] transition-opacity duration-150 group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

function CollapsibleGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-edge bg-panel2/20">
      <button className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-ink transition-colors duration-200 hover:text-accent" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {title}
      </button>
      {open && <div className="grid gap-4 border-t border-edge/60 p-4 sm:grid-cols-2">{children}</div>}
    </div>
  );
}

function NumberField({
  label,
  tip,
  warn,
  value,
  min,
  max,
  step,
  onChange,
  suffix
}: {
  label: string;
  tip?: string;
  warn?: boolean;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div>
      <label className="label flex items-center">
        <span className="flex items-center">
          {label}{suffix ? ` (${suffix})` : ""}
          {tip && <InfoTip text={tip} />}
        </span>
        {warn && (
          <span className="ml-1.5 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-400" title="Above the recommended safe range — the agent may burn credits or time">
            high
          </span>
        )}
      </label>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
    </div>
  );
}

function AgentSection() {
  const { settings, patchSettings } = useSettingsStore();
  const agent = settings?.agent;
  if (!agent) return null;
  const set = (patch: Partial<AgentSettings>): void => void patchSettings({ agent: { ...agent, ...patch } });
  return (
    <div className="space-y-4">
      <CollapsibleGroup title="Loop Control">
        <NumberField
          label="Maximum iterations per task"
          tip="Maximum number of agent decision loops before stopping. Higher values allow more complex tasks but consume more API credits. Recommended: 40."
          warn={agent.maxIterations > 60}
          value={agent.maxIterations}
          min={1}
          max={120}
          onChange={(v) => set({ maxIterations: v })}
        />
        <NumberField
          label="Command timeout"
          suffix="seconds"
          tip="How long a terminal command can run before being killed. Recommended: 120 seconds."
          warn={agent.commandTimeoutMs > 600000}
          value={Math.round(agent.commandTimeoutMs / 1000)}
          min={5}
          max={1800}
          onChange={(v) => set({ commandTimeoutMs: v * 1000 })}
        />
      </CollapsibleGroup>

      <CollapsibleGroup title="Context Management">
        <NumberField
          label="Maximum context size"
          suffix="k chars"
          tip="Maximum characters of chat history kept in memory. Older messages are summarized. Recommended: 260."
          warn={agent.maxContextChars > 400000}
          value={Math.round(agent.maxContextChars / 1000)}
          min={20}
          max={600}
          onChange={(v) => set({ maxContextChars: v * 1000 })}
        />
        <NumberField
          label="Maximum tool output"
          suffix="k chars"
          tip="Maximum characters returned by any single tool call. Prevents context overflow from large file reads. Recommended: 28."
          warn={agent.maxOutputPerTool > 80000}
          value={Math.round(agent.maxOutputPerTool / 1000)}
          min={2}
          max={120}
          onChange={(v) => set({ maxOutputPerTool: v * 1000 })}
        />
        <NumberField
          label="Max tokens per response"
          tip="Maximum length of a single AI response. Recommended: 8192."
          warn={agent.maxTokens > 32000}
          value={agent.maxTokens}
          min={256}
          max={64000}
          onChange={(v) => set({ maxTokens: v })}
        />
        <NumberField
          label="Temperature"
          tip="Controls randomness. Lower = more deterministic and focused. Higher = more creative. Recommended for coding: 0.1 to 0.3."
          warn={agent.temperature > 0.5}
          value={agent.temperature}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => set({ temperature: v })}
        />
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="accent-[#d97757]" checked={agent.autoImportScan} onChange={(e) => set({ autoImportScan: e.target.checked })} />
          Automatic import scanning
          <InfoTip text="When enabled, the agent automatically reads signatures from imported files to understand context without loading full files." />
        </label>
      </CollapsibleGroup>

      <div className="flex items-center justify-between">
        <p className="max-w-md text-[11px] leading-relaxed text-muted">
          Settings apply to the next agent run. Loop protection stops repeated identical tool calls automatically, and the agent wraps up gracefully as the context budget fills.
        </p>
        <button
          className="btn-ghost shrink-0"
          title="Restore all agent settings to recommended defaults"
          onClick={() => void patchSettings({ agent: { ...DEFAULT_AGENT_SETTINGS } })}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset to Defaults
        </button>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const { settings, setTheme, setCustomColors, patchSettings } = useSettingsStore();
  const current = settings?.ui.theme ?? "warm-dark";
  const custom = settings?.ui.custom ?? { bg: "#141414", panel: "#1e1e1e", text: "#ece7e1", accent: "#d97757" };
  return (
    <div>
      <div className="mb-4 max-w-xs">
        <label className="label">Display name (dashboard greeting)</label>
        <input
          className="input"
          value={settings?.ui.displayName ?? ""}
          placeholder="(uses Windows username)"
          onChange={(e) => {
            const ui = settings?.ui ?? { theme: "warm-dark" as const };
            void patchSettings({ ui: { ...ui, displayName: e.target.value } });
          }}
        />
      </div>
      <div className="mb-5">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="accent-[#d97757]"
            checked={settings?.ui.lowMemoryMode === true}
            onChange={(e) => {
              const ui = settings?.ui ?? { theme: "warm-dark" as const };
              void patchSettings({ ui: { ...ui, lowMemoryMode: e.target.checked } });
            }}
          />
          Low Memory Mode (disables GPU acceleration)
        </label>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          For 4 GB RAM machines. Requires a restart to take effect. Previews of WebGL/3D content may be slow in Low
          Memory Mode — they still run, just without GPU compositing.
        </p>
      </div>
      <div className="label">Theme presets</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {THEME_PRESETS.map((p) => (
          <button
            key={p.id}
            className={clsx("rounded-xl border p-3 text-left transition-colors duration-200", current === p.id ? "border-accent bg-accent/10" : "border-edge hover:bg-panel2")}
            onClick={() => void setTheme(p.id)}
            title={p.label}
          >
            <div className="mb-2 flex gap-1">
              <span className="h-5 w-5 rounded-md border border-edge" style={{ background: p.vars.bg }} />
              <span className="h-5 w-5 rounded-md border border-edge" style={{ background: p.vars.panel }} />
              <span className="h-5 w-5 rounded-md" style={{ background: p.vars.accent }} />
              <span className="h-5 w-5 rounded-full border border-edge" style={{ background: p.vars.ink }} />
            </div>
            <div className={clsx("text-xs", current === p.id ? "font-semibold text-accent" : "text-ink/85")}>{p.label}</div>
          </button>
        ))}
        <button
          className={clsx("rounded-xl border p-3 text-left transition-colors duration-200", current === "custom" ? "border-accent bg-accent/10" : "border-edge hover:bg-panel2")}
          onClick={() => void setTheme("custom")}
          title="Custom — pick your own colors"
        >
          <div className="mb-2 flex gap-1">
            <span className="h-5 w-5 rounded-md border border-edge" style={{ background: custom.bg }} />
            <span className="h-5 w-5 rounded-md border border-edge" style={{ background: custom.panel }} />
            <span className="h-5 w-5 rounded-md" style={{ background: custom.accent }} />
            <span className="h-5 w-5 rounded-full border border-edge" style={{ background: custom.text }} />
          </div>
          <div className={clsx("text-xs", current === "custom" ? "font-semibold text-accent" : "text-ink/85")}>Custom</div>
        </button>
      </div>
      {current === "custom" && (
        <div className="mt-4 grid gap-3 rounded-xl border border-edge bg-panel2/30 p-4 sm:grid-cols-4">
          {([
            ["bg", "Background"],
            ["panel", "Panel / Sidebar"],
            ["text", "Text"],
            ["accent", "Accent"]
          ] as const).map(([key, label]) => (
            <div key={key}>
              <label className="label">{label}</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  className="h-8 w-9 cursor-pointer rounded border border-edge bg-panel"
                  value={custom[key]}
                  onChange={(e) => void setCustomColors({ ...custom, [key]: e.target.value })}
                />
                <input className="input !w-24 font-mono text-xs" value={custom[key]} onChange={(e) => void setCustomColors({ ...custom, [key]: e.target.value })} />
              </div>
            </div>
          ))}
          <div className="text-[11px] text-muted sm:col-span-4">
            Edge, muted, panel-2 and derived surfaces are computed automatically from your four colors.
          </div>
        </div>
      )}
    </div>
  );
}

function WorkspaceSection() {
  const { root, recent, openViaDialog, openPath } = useWorkspaceStore();
  return (
    <div>
      <div className="mb-3 text-sm text-ink">
        Current: <span className="font-mono text-xs text-muted">{root ?? "none"}</span>
      </div>
      <button className="btn-primary mb-3" onClick={() => void openViaDialog()}>
        Open workspace folder…
      </button>
      <IndexWorkspaceButton inline />
      <div className="label">Recent workspaces</div>
      {recent.length === 0 && <div className="text-xs text-muted">None yet.</div>}
      <div className="space-y-1">
        {recent.map((r) => (
          <button key={r} className="w-full truncate rounded border border-transparent px-2 py-1 text-left font-mono text-xs text-ink/80 hover:border-edge hover:bg-panel2" onClick={() => void openPath(r)}>
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

function DiagnosticsCard() {
  const [diag, setDiag] = useState<Awaited<ReturnType<typeof call>> | null>(null);
  const toast = useUiStore((s) => s.toastMessage);
  useEffect(() => {
    void call(api.utcode.appDiagnostics()).then((d) => setDiag(d)).catch(() => undefined);
  }, []);
  if (!diag) return null;
  const d = diag as import("../../shared/types").AppDiagnostics;
  const summary = [
    `utcode v${d.appVersion}`,
    `Electron ${d.electron} · Node ${d.node} · Chromium ${d.chromium} · V8 ${d.v8}`,
    `${d.platform} ${d.arch}`,
    `workspace: ${d.workspace ?? "none"}`,
    `agents running: ${d.runningAgents} · watcher: ${d.watcherActive ? "on" : "off"}`,
    `index: ${d.vectorFiles} files / ${d.vectorChunks} chunks (${d.vectorBackend})`,
    `provider: ${d.activeProvider ?? "none"} of ${d.providerCount}`,
    `userData: ${d.userDataPath}`,
    `log: ${d.logPath}`
  ].join("\n");
  const row = (k: string, v: string): JSX.Element => (
    <div key={k} className="flex gap-2">
      <span className="w-40 shrink-0 text-muted/70">{k}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-ink/85" title={v}>{v}</span>
    </div>
  );
  return (
    <details className="mt-6 w-full rounded-xl border border-edge bg-panel2/20 text-left text-[11px]">
      <summary className="cursor-pointer select-none px-4 py-2.5 font-medium text-muted transition-colors duration-200 hover:text-ink">
        Diagnostics — runtime info, paths & recent log warnings
      </summary>
      <div className="space-y-1.5 border-t border-edge/60 px-4 py-3">
        {row("app", `utcode v${d.appVersion}`)}
        {row("runtimes", `Electron ${d.electron} · Node ${d.node} · Chromium ${d.chromium}`)}
        {row("os", `${d.platform} ${d.arch}`)}
        {row("workspace", d.workspace ?? "none")}
        {row("agents / watcher", `${d.runningAgents} running · watcher ${d.watcherActive ? "on" : "off"}`)}
        {row("codebase index", `${d.vectorFiles} files / ${d.vectorChunks} chunks · ${d.vectorBackend}`)}
        {row("provider", `${d.activeProvider ?? "none"} (${d.providerCount} configured)`)}
        {row("userData", d.userDataPath)}
        {row("log file", d.logPath)}
        {d.lastErrors.length > 0 && (
          <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-950/10 p-2 font-mono text-[10px] text-amber-300/90">
            {d.lastErrors.map((l, i) => (
              <div key={i} className="truncate" title={l}>{l}</div>
            ))}
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <button
            className="btn-ghost !px-2.5 !py-1 text-[11px]"
            onClick={() => {
              void navigator.clipboard.writeText(summary).then(
                () => toast("Diagnostics copied to clipboard", "info"),
                () => toast("Clipboard unavailable", "error")
              );
            }}
          >
            Copy all
          </button>
          <button className="btn-ghost !px-2.5 !py-1 text-[11px]" onClick={() => void call(api.utcode.revealPath(d.logPath)).catch(() => toast("Could not reveal log", "error"))}>
            Reveal log in Explorer
          </button>
        </div>
      </div>
    </details>
  );
}

const TECH_LINKS: { label: string; url: string }[] = [
  { label: "Electron", url: "https://electronjs.org" },
  { label: "React", url: "https://react.dev" },
  { label: "TypeScript", url: "https://typescriptlang.org" },
  { label: "Tailwind CSS", url: "https://tailwindcss.com" },
  { label: "Monaco", url: "https://microsoft.github.io/monaco-editor" },
  { label: "MCP", url: "https://modelcontextprotocol.io" }
];

function AboutSection() {
  const [version, setVersion] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const toast = useUiStore((s) => s.toastMessage);

  useEffect(() => {
    void call(api.utcode.appInfo()).then((i) => setVersion(i.version)).catch(() => undefined);
  }, []);

  const open = (url: string): void => {
    void call(api.utcode.openExternal(url)).catch((err: unknown) =>
      toast(err instanceof Error ? err.message : String(err), "error")
    );
  };

  const repoUrl = `https://github.com/${GITHUB_REPO}`;

  const checkUpdates = async (): Promise<void> => {
    setChecking(true);
    try {
      const latest = await call(api.utcode.appLatestRelease());
      if (!latest) toast("No published releases found yet for this build.", "info");
      else if (version && latest.replace(/^v/i, "") !== version) {
        toast(`utcode v${latest} is available — you are on v${version}.`, "info");
        open(`${repoUrl}/releases/latest`);
      } else toast(`You're on the latest version (v${version}).`, "info");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Update check failed.", "error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center overflow-y-auto text-center">
      <UtcodeBrand logoSize={104} version={version} className="mt-2" />
      <div className="mt-1 text-xs italic text-muted">"It works on my machine. Don't know about yours."</div>

      <div className="mt-6 w-full rounded-xl border border-edge bg-panel p-5 text-left text-[13px] leading-relaxed">
        <p>
          <span className="font-semibold text-ink">Developed by:</span> <span className="text-ink/85">Chakshu Julka</span>
        </p>
        <p className="mt-2 text-muted">
          <span className="font-semibold text-ink">Powered by:</span> Questionable amounts of caffeine, an unhealthy
          obsession with clean UI, and the existential dread of unresolved merge conflicts.
        </p>
        <p className="mt-2 text-muted">
          <span className="font-semibold text-ink">Special Thanks:</span> To the AI that wrote this code while I watched.
        </p>
        <p className="mt-2 text-muted">
          <span className="font-semibold text-ink">Built with:</span> Electron, React, and a dream (that one day it
          won't lag on 4GB RAM).
        </p>
      </div>

      <div className="mt-5 flex max-w-md flex-wrap items-center justify-center gap-1.5">
        {TECH_LINKS.map((t) => (
          <button
            key={t.label}
            className="cursor-pointer rounded-md bg-panel2 px-2 py-1 text-xs text-muted transition-colors duration-200 hover:bg-[#333] hover:text-white"
            title={`Open ${t.label} docs`}
            onClick={() => open(t.url)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <DiagnosticsCard />

      <div className="mt-6 mb-8 flex flex-wrap items-center justify-center gap-4 text-xs">
        <button className="flex items-center gap-1.5 text-muted transition-colors duration-200 hover:text-ink" onClick={() => open(repoUrl)}>
          <Github className="h-3.5 w-3.5" /> GitHub
        </button>
        <button className="flex items-center gap-1.5 text-muted transition-colors duration-200 hover:text-red-400" onClick={() => open(`${repoUrl}/issues`)}>
          <Bug className="h-3.5 w-3.5" /> Report a Bug
        </button>
        <button className="flex items-center gap-1.5 text-muted transition-colors duration-200 hover:text-accent" onClick={() => void checkUpdates()} disabled={checking}>
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Check for Updates
        </button>
      </div>
    </div>
  );
}

import { useUiStore } from "../stores/uiStore";

export function SettingsModal() {
  const isOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const [section, setSection] = useState<Section>("Providers");
  if (!isOpen) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm" onClick={() => setSettingsOpen(false)}>
      <div
        className="flex h-[80vh] w-[860px] max-w-full flex-col overflow-hidden rounded-2xl border border-edge bg-canvas shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4 border-b border-edge px-4 py-2.5">
          <span className="text-sm font-semibold text-ink">Settings</span>
          <nav className="flex gap-1">
            {SECTIONS.map((s) => (
              <button
                key={s}
                className={clsx("rounded-md px-2.5 py-1 text-[13px]", section === s ? "bg-accent/15 text-accent" : "text-muted hover:text-ink")}
                onClick={() => setSection(s)}
              >
                {s}
              </button>
            ))}
          </nav>
          <button className="ml-auto rounded p-1 text-muted hover:text-ink" onClick={() => setSettingsOpen(false)}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {section === "Providers" && <ProvidersSection />}
          {section === "Router" && <RouterSection />}
          {section === "Vector" && <VectorSection />}
          {section === "MCP" && <McpSection />}
          {section === "Agent" && <AgentSection />}
          {section === "Appearance" && <AppearanceSection />}
          {section === "Workspace" && <WorkspaceSection />}
          {section === "About" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
