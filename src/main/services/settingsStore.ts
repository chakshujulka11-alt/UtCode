import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_AGENT_SETTINGS, DEFAULT_PRICING, DEFAULT_ROUTER, DEFAULT_VECTOR, MAX_RECENT_WORKSPACES, SETTINGS_FILE } from "../../shared/constants";
import type { AppSettings, ProviderConfig, ProviderInput, RouterSettings } from "../../shared/types";
import { logger } from "./logger";
import { decryptSecret, encryptSecret, maskSecret } from "./secureKeys";

interface SecretsFile {
  keys: Record<string, string>;
}

const DEFAULTS: AppSettings = {
  version: 1,
  defaultProviderId: null,
  activeProviderId: null,
  providers: [],
  agent: { ...DEFAULT_AGENT_SETTINGS },
  ui: { theme: "warm-dark" as const },
  recentWorkspaces: [],
  mcpConfigPath: null,
  router: structuredClone(DEFAULT_ROUTER),
  vector: { ...DEFAULT_VECTOR },
  pricing: { ...DEFAULT_PRICING }
};

function mergeRouter(base: RouterSettings, patch?: Partial<RouterSettings>): RouterSettings {
  return {
    mode: patch?.mode ?? base.mode,
    tiers: {
      1: { ...base.tiers[1], ...(patch?.tiers?.[1] ?? {}) },
      2: { ...base.tiers[2], ...(patch?.tiers?.[2] ?? {}) },
      3: { ...base.tiers[3], ...(patch?.tiers?.[3] ?? {}) }
    }
  };
}

class SettingsStore {
  private settings: AppSettings = structuredClone(DEFAULTS);
  private secrets: SecretsFile = { keys: {} };
  private loaded = false;

  private get settingsPath(): string {
    return path.join(app.getPath("userData"), SETTINGS_FILE);
  }

  private get secretsPath(): string {
    return path.join(app.getPath("userData"), "secrets.json");
  }

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(this.settingsPath)) {
        const raw = JSON.parse(fs.readFileSync(this.settingsPath, "utf-8")) as Partial<AppSettings>;
        this.settings = {
          ...structuredClone(DEFAULTS),
          ...raw,
          agent: { ...DEFAULT_AGENT_SETTINGS, ...(raw.agent ?? {}) },
          ui: { ...DEFAULTS.ui, ...(raw.ui ?? {}) },
          router: mergeRouter(structuredClone(DEFAULT_ROUTER), raw.router ?? undefined),
          vector: { ...DEFAULT_VECTOR, ...(raw.vector ?? {}) },
          pricing: { ...DEFAULT_PRICING, ...(raw.pricing ?? {}) },
          providers: (raw.providers ?? []).map((p) => ({ ...p, apiKeyPresent: !!this.secrets.keys[p.id] })),
          recentWorkspaces: raw.recentWorkspaces ?? []
        };
      }
    } catch (err) {
      logger.error("settings", `Failed to load settings: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      if (fs.existsSync(this.secretsPath)) {
        this.secrets = JSON.parse(fs.readFileSync(this.secretsPath, "utf-8")) as SecretsFile;
        if (!this.secrets.keys) this.secrets.keys = {};
      }
    } catch (err) {
      logger.error("settings", `Failed to load secrets: ${err instanceof Error ? err.message : String(err)}`);
      this.secrets = { keys: {} };
    }
    for (const p of this.settings.providers) {
      p.apiKeyPresent = Boolean(this.secrets.keys[p.id]);
      p.apiKeyMasked = p.apiKeyPresent ? "••••••••" : undefined;
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
      const copy: AppSettings = structuredClone(this.settings);
      copy.providers = copy.providers.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        model: p.model,
        baseUrl: p.baseUrl,
        enabled: p.enabled,
        availableModels: p.availableModels
      }));
      fs.writeFileSync(this.settingsPath, JSON.stringify(copy, null, 2), "utf-8");
      fs.writeFileSync(this.secretsPath, JSON.stringify(this.secrets, null, 2), { encoding: "utf-8", mode: 0o600 });
    } catch (err) {
      logger.error("settings", `Failed to persist settings: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  get(): AppSettings {
    this.load();
    return structuredClone(this.settings);
  }

  getPublicProviders(): ProviderConfig[] {
    this.load();
    return this.settings.providers.map((p) => ({
      ...p,
      apiKeyPresent: Boolean(this.secrets.keys[p.id]),
      apiKeyMasked: this.secrets.keys[p.id] ? maskSecret(decryptSecret(this.secrets.keys[p.id])) : undefined
    }));
  }

  getApiKey(providerId: string): string {
    this.load();
    const stored = this.secrets.keys[providerId];
    return stored ? decryptSecret(stored) : "";
  }

  saveProvider(input: ProviderInput): ProviderConfig {
    this.load();
    const existing = this.settings.providers.find((p) => p.id === input.id);
    const config: ProviderConfig = {
      id: input.id,
      name: input.name,
      type: input.type,
      model: input.model,
      baseUrl: input.baseUrl,
      enabled: input.enabled
    };
    if (input.apiKey && input.apiKey.length > 0) {
      this.secrets.keys[config.id] = encryptSecret(input.apiKey);
    } else if (!existing) {
      delete this.secrets.keys[config.id];
    }
    if (Array.isArray(input.availableModels)) {
      config.availableModels = input.availableModels;
    } else if (existing?.availableModels) {
      config.availableModels = existing.availableModels;
    }
    if (existing) {
      this.settings.providers = this.settings.providers.map((p) => (p.id === config.id ? config : p));
    } else {
      this.settings.providers.push(config);
    }
    if (!this.settings.activeProviderId) this.settings.activeProviderId = config.id;
    if (!this.settings.defaultProviderId) this.settings.defaultProviderId = config.id;
    config.apiKeyPresent = Boolean(this.secrets.keys[config.id]);
    this.persist();
    return config;
  }

  setProviderModels(id: string, models: string[]): void {
    this.load();
    this.settings.providers = this.settings.providers.map((p) =>
      p.id === id ? { ...p, availableModels: models.slice(0, 500) } : p
    );
    this.persist();
  }

  deleteProvider(id: string): void {    this.load();
    this.settings.providers = this.settings.providers.filter((p) => p.id !== id);
    delete this.secrets.keys[id];
    if (this.settings.activeProviderId === id) {
      this.settings.activeProviderId = this.settings.providers[0]?.id ?? null;
    }
    if (this.settings.defaultProviderId === id) {
      this.settings.defaultProviderId = this.settings.providers[0]?.id ?? null;
    }
    this.persist();
  }

  setDefaultProvider(id: string | null): void {
    this.load();
    this.settings.defaultProviderId = id;
    this.settings.activeProviderId = id ?? this.settings.activeProviderId;
    this.persist();
  }

  update(partial: Partial<AppSettings>): AppSettings {
    this.load();
    if (partial.defaultProviderId !== undefined) this.settings.defaultProviderId = partial.defaultProviderId;
    if (partial.activeProviderId !== undefined) this.settings.activeProviderId = partial.activeProviderId;
    if (partial.agent) this.settings.agent = { ...this.settings.agent, ...partial.agent };
    if (partial.ui) this.settings.ui = { ...this.settings.ui, ...partial.ui };
    if (partial.router) this.settings.router = mergeRouter(this.settings.router, partial.router);
    if (partial.vector) this.settings.vector = { ...this.settings.vector, ...partial.vector };
    if (partial.pricing) this.settings.pricing = { ...this.settings.pricing, ...partial.pricing };
    if (partial.mcpConfigPath !== undefined) this.settings.mcpConfigPath = partial.mcpConfigPath;
    this.persist();
    return this.get();
  }

  addRecentWorkspace(root: string): void {
    this.load();
    this.settings.recentWorkspaces = [root, ...this.settings.recentWorkspaces.filter((w) => w !== root)].slice(
      0,
      MAX_RECENT_WORKSPACES
    );
    this.persist();
  }

  get agentSettings() {
    this.load();
    return this.settings.agent;
  }
}

export const settingsStore = new SettingsStore();
