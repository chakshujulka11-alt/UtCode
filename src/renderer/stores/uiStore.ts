import { create } from "zustand";
import type { UiSettings } from "../../shared/types";
import { api, call } from "./api";

export interface UiState {
  isSidebarOpen: boolean;
  rightOpen: boolean;
  panelTab: "code" | "diff" | "preview" | "terminal";
  settingsOpen: boolean;
  sidebarWidth: number;
  workspaceWidth: number;
  toast: { message: string; type: "info" | "error" } | null;
  previewNonce: number;
  windowWidth: number;
  bumpPreview(): void;
  setWindowWidth(px: number): void;
  setIsSidebarOpen(open: boolean): void;
  toggleSidebar(): void;
  toggleRight(): void;
  setPanelTab(tab: UiState["panelTab"]): void;
  setSettingsOpen(open: boolean): void;
  setSidebarWidth(px: number): void;
  setWorkspaceWidth(px: number): void;
  resetSidebarWidth(): void;
  resetWorkspaceWidth(): void;
  applyLayout(ui: UiSettings): void;
  persistLayout(): void;
  toastMessage(message: string, type?: "info" | "error"): void;
}

const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 300;
const SIDEBAR_DEFAULT = 240;
const WORKSPACE_MIN = 350;
const CHAT_MIN = 360;
const WORKSPACE_DEFAULT = 620;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

function workspaceMax(): number {
  const s = useUiStore.getState();
  const reserved = (s.isSidebarOpen ? s.sidebarWidth : 52) + CHAT_MIN + 24;
  return Math.max(WORKSPACE_MIN, (s.windowWidth || window.innerWidth) - reserved);
}

let toastTimer: number | null = null;
let persistTimer: number | null = null;

export const useUiStore = create<UiState>((set, get) => ({
  isSidebarOpen: false,
  rightOpen: true,
  panelTab: "code",
  settingsOpen: false,
  sidebarWidth: SIDEBAR_DEFAULT,
  workspaceWidth: WORKSPACE_DEFAULT,
  toast: null,
  previewNonce: 0,
  windowWidth: typeof window !== "undefined" ? window.innerWidth : 1440,
  bumpPreview: () => set((s) => ({ previewNonce: s.previewNonce + 1 })),
  setWindowWidth: (px) => set({ windowWidth: px }),
  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),
  setIsSidebarOpen: (open) => set({ isSidebarOpen: open }),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  setPanelTab: (tab) => set({ panelTab: tab, rightOpen: true }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSidebarWidth: (px) => set({ sidebarWidth: clamp(px, SIDEBAR_MIN, SIDEBAR_MAX) }),
  setWorkspaceWidth: (px) =>
    set({ workspaceWidth: clamp(px, WORKSPACE_MIN, workspaceMax()) }),
  resetSidebarWidth: () => {
    get().setSidebarWidth(SIDEBAR_DEFAULT);
    get().persistLayout();
  },
  resetWorkspaceWidth: () => {
    get().setWorkspaceWidth(WORKSPACE_DEFAULT);
    get().persistLayout();
  },
  applyLayout: (ui) =>
    set((s) => ({
      sidebarWidth: ui.sidebarWidth ? clamp(ui.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX) : s.sidebarWidth,
      workspaceWidth: ui.workspaceWidth ? clamp(ui.workspaceWidth, WORKSPACE_MIN, 2600) : s.workspaceWidth
    })),
  persistLayout: () => {
    if (persistTimer !== null) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = null;
      const { sidebarWidth, workspaceWidth } = get();
      import("./settingsStore")
        .then(({ useSettingsStore }) => {
          const theme = useSettingsStore.getState().settings?.ui.theme ?? "dark";
          void call(api.utcode.settingsSave({ ui: { theme, sidebarWidth, workspaceWidth } })).catch(() => undefined);
        })
        .catch(() => undefined);
    }, 250);
  },
  toastMessage: (message, type = "info") => {
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    set({ toast: { message, type } });
    toastTimer = window.setTimeout(() => set({ toast: null }), 4200);
  }
}));
