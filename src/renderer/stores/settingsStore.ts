import { create } from "zustand";
import type { AppSettings, McpServerConfig, McpServerStatus, ProviderConfig, ProviderInput, ProviderTestResult, UiSettings, VectorStatus } from "../../shared/types";
import { api, call } from "./api";
import { applyUiTheme } from "../theme";

interface SettingsState {
  settings: AppSettings | null;
  providers: ProviderConfig[];
  mcp: McpServerStatus[];
  tests: Record<string, ProviderTestResult & { pending?: boolean }>;
  modelFetch: Record<string, { pending?: boolean; error?: string; count?: number }>;
  mcpBusy: string | null;
  indexProgress: { done: number; total: number } | null;
  vectorStats: VectorStatus | null;
  recentModels: import("../../shared/types").RecentModel[];
  favorites: string[];
  loadFavorites(): Promise<void>;
  toggleFavorite(model: string): void;
  loadRecentModels(): Promise<void>;
  recordRecentModel(providerId: string, model: string): void;
  error: string | null;
  init(): Promise<void>;
  handleIndexEvent(ev: { status?: string; done?: number; total?: number }): void;
  runVectorIndex(rebuild: boolean): Promise<void>;
  loadVectorStatus(): Promise<void>;
  reload(): Promise<void>;
  saveProvider(input: ProviderInput): Promise<boolean>;
  deleteProvider(id: string): Promise<void>;
  testProvider(id: string): Promise<void>;
  fetchModels(id: string): Promise<string[]>;
  setActiveProvider(id: string): Promise<void>;
  selectModel(providerId: string, model: string): Promise<void>;
  setDefault(id: string | null): Promise<void>;
  patchSettings(patch: Partial<AppSettings>): Promise<void>;
  setTheme(theme: AppSettings["ui"]["theme"]): Promise<void>;
  setCustomColors(custom: UiSettings["custom"]): Promise<void>;
  saveMcp(server: McpServerConfig): Promise<void>;
  deleteMcp(name: string): Promise<void>;
  connectMcp(name: string): Promise<void>;
  disconnectMcp(name: string): Promise<void>;
  importMcp(): Promise<void>;
  mcpTools(name: string): Promise<{ name: string; description: string }[]>;
  handleMcpEvent(event: { status?: string; server?: string; toolCount?: number }): void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  providers: [],
  mcp: [],
  tests: {},
  modelFetch: {},
  mcpBusy: null,
  indexProgress: null,
  vectorStats: null,
  recentModels: [],

  async loadRecentModels() {
    try {
      const models = await call(api.utcode.storeGet("recentModels"));
      if (Array.isArray(models)) set({ recentModels: models as import("../../shared/types").RecentModel[] });
    } catch {
      /* keep current */
    }
  },

  recordRecentModel(providerId, model) {
    void call(api.utcode.storeRememberModel(providerId, model))
      .then((list) => set({ recentModels: list }))
      .catch(() => undefined);
  },

  favorites: [],

  async loadFavorites() {
    try {
      const favs = await call(api.utcode.storeGet("favorites"));
      if (Array.isArray(favs)) set({ favorites: favs as string[] });
    } catch {
      /* keep current */
    }
  },

  toggleFavorite(model) {
    const current = get().favorites;
    const next = current.includes(model) ? current.filter((m) => m !== model) : [...current, model];
    set({ favorites: next });
    void call(api.utcode.storeSet("favorites", next)).catch(() => undefined);
  },
  error: null,

  async init() {
    await get().reload();
    void get().loadVectorStatus();
    void get().loadRecentModels();
    void get().loadFavorites();
  },

  handleIndexEvent(ev) {
    if (ev.status === "complete") {
      set({ indexProgress: null });
      void get().loadVectorStatus();
      return;
    }
    set({ indexProgress: { done: ev.done ?? 0, total: ev.total ?? 0 } });
  },

  async runVectorIndex(rebuild) {
    set({ indexProgress: { done: 0, total: 0 } });
    try {
      const stats = await call(api.utcode.vectorIndex(rebuild));
      set({ vectorStats: stats, indexProgress: null });
    } catch (err) {
      set({ indexProgress: null, error: err instanceof Error ? err.message : String(err) });
    }
  },

  async loadVectorStatus() {
    try {
      const stats = await call(api.utcode.vectorStatus());
      set({ vectorStats: stats });
    } catch {
      set({ vectorStats: null });
    }
  },

  async reload() {
    try {
      const [settings, providers, mcp] = await Promise.all([
        call(api.utcode.settingsGet()),
        call(api.utcode.providerList()),
        call(api.utcode.mcpList())
      ]);
      applyUiTheme(settings.ui);
      set({ settings, providers, mcp, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async saveProvider(input) {
    try {
      await call(api.utcode.providerSave(input));
      await get().reload();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  async deleteProvider(id) {
    try {
      await call(api.utcode.providerDelete(id));
      await get().reload();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async testProvider(id) {
    set((s) => ({ tests: { ...s.tests, [id]: { ok: false, pending: true } } }));
    try {
      const result = await call(api.utcode.providerTest(id));
      set((s) => ({ tests: { ...s.tests, [id]: result } }));
    } catch (err) {
      set((s) => ({
        tests: { ...s.tests, [id]: { ok: false, error: err instanceof Error ? err.message : String(err) } }
      }));
    }
  },

  async fetchModels(id) {
    set((s) => ({ modelFetch: { ...s.modelFetch, [id]: { pending: true } } }));
    try {
      const models = await call(api.utcode.providerFetchModels(id));
      set((s) => ({ modelFetch: { ...s.modelFetch, [id]: { count: models.length } } }));
      await get().reload();
      return models;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({ modelFetch: { ...s.modelFetch, [id]: { error: message } } }));
      return [];
    }
  },

  async setActiveProvider(id) {
    try {
      await call(api.utcode.settingsSave({ activeProviderId: id }));
      await get().reload();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async selectModel(providerId, model) {
    const provider = get().providers.find((p) => p.id === providerId);
    if (!provider) return;
    try {
      await call(
        api.utcode.providerSave({
          id: provider.id,
          name: provider.name,
          type: provider.type,
          model,
          baseUrl: provider.baseUrl,
          enabled: provider.enabled,
          availableModels: provider.availableModels
        })
      );
      await call(api.utcode.settingsSave({ activeProviderId: providerId }));
      await get().reload();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async setCustomColors(custom) {
    const ui = get().settings?.ui;
    applyUiTheme({ theme: "custom", custom });
    await get().patchSettings({ ui: { ...(ui ?? { theme: "custom" }), theme: "custom", custom } });
  },

  async setDefault(id) {
    try {
      await call(api.utcode.providerSetDefault(id));
      await get().reload();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async patchSettings(patch) {
    try {
      const settings = await call(api.utcode.settingsSave(patch));
      set({ settings });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async setTheme(theme) {
    applyUiTheme({ theme, custom: get().settings?.ui.custom });
    await get().patchSettings({ ui: { theme } });
  },

  async saveMcp(server) {
    try {
      const mcp = await call(api.utcode.mcpSave(server));
      set({ mcp });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async deleteMcp(name) {
    try {
      const mcp = await call(api.utcode.mcpDelete(name));
      set({ mcp });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async connectMcp(name) {
    set({ mcpBusy: name });
    try {
      await call(api.utcode.mcpConnect(name));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ mcpBusy: null });
      await get().reload();
    }
  },

  async disconnectMcp(name) {
    set({ mcpBusy: name });
    try {
      await call(api.utcode.mcpDisconnect(name));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ mcpBusy: null });
      await get().reload();
    }
  },

  async importMcp() {
    try {
      await call(api.utcode.mcpImport());
      await get().reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/cancelled/i.test(message)) set({ error: message });
    }
  },

  async mcpTools(name) {
    try {
      return await call(api.utcode.mcpTools(name));
    } catch {
      return [];
    }
  },

  handleMcpEvent(event) {
    if (!event.server) return;
    set((s) => ({
      mcp: s.mcp.map((m) =>
        m.name === event.server
          ? {
              ...m,
              status:
                event.status === "connected" || event.status === "connecting" || event.status === "error" || event.status === "stopped"
                  ? (event.status as McpServerStatus["status"])
                  : m.status,
              toolCount: typeof event.toolCount === "number" ? event.toolCount : m.toolCount
            }
          : m
      )
    }));
  }
}));
