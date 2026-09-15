import { create } from "zustand";
import type { WorkspaceFileInfo } from "../../shared/types";
import { api, call } from "./api";

interface WorkspaceState {
  root: string | null;
  recent: string[];
  children: Record<string, WorkspaceFileInfo[]>;
  loading: Record<string, boolean>;
  expanded: Record<string, boolean>;
  highlightPath: string | null;
  error: string | null;
  busy: boolean;
  init(): Promise<void>;
  openViaDialog(): Promise<string | null>;
  openPath(root: string): Promise<void>;
  toggleDir(dir: string): Promise<void>;
  refreshDir(dir: string): Promise<void>;
  refreshAll(): Promise<void>;
  revealPath(relPath: string): Promise<void>;
}

const touchQueue = new Map<string, number>();
let touchTimer: number | null = null;

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  root: null,
  recent: [],
  children: {},
  loading: {},
  expanded: {},
  highlightPath: null,
  error: null,
  busy: false,

  async init() {
    try {
      const [root, settings] = await Promise.all([
        call(api.utcode.workspaceGet()).catch(() => null),
        call(api.utcode.settingsGet()).catch(() => null)
      ]);
      set({ recent: settings?.recentWorkspaces ?? [] });
      if (root) {
        set({ root });
        await get().refreshDir(".");
        set((s) => ({ expanded: { ...s.expanded, ".": true } }));
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async openViaDialog() {
    set({ busy: true, error: null });
    try {
      const root = await call(api.utcode.workspaceOpen());
      if (root) {
        set({ root, children: {}, expanded: { ".": true }, busy: false });
        await get().refreshDir(".");
        const settings = await call(api.utcode.settingsGet()).catch(() => null);
        if (settings) set({ recent: settings.recentWorkspaces });
      } else {
        set({ busy: false });
      }
      return root;
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  async openPath(root: string) {
    set({ busy: true, error: null });
    try {
      await call(api.utcode.workspaceOpenPath(root));
      set({ root, children: {}, expanded: { ".": true }, busy: false });
      await get().refreshDir(".");
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  async toggleDir(dir: string) {
    const open = !get().expanded[dir];
    set((s) => ({ expanded: { ...s.expanded, [dir]: open } }));
    if (open && !get().children[dir]) {
      await get().refreshDir(dir);
    }
  },

  async refreshDir(dir: string) {
    set((s) => ({ loading: { ...s.loading, [dir]: true } }));
    try {
      const entries = await call(api.utcode.workspaceList(dir));
      set((s) => ({
        children: { ...s.children, [dir]: entries },
        loading: { ...s.loading, [dir]: false }
      }));
    } catch (err) {
      set((s) => ({ loading: { ...s.loading, [dir]: false }, error: err instanceof Error ? err.message : String(err) }));
    }
  },

  async refreshAll() {
    const { root, expanded } = get();
    if (!root) return;
    set({ children: {} });
    for (const dir of Object.keys(expanded)) {
      await get().refreshDir(dir);
    }
  },

  async revealPath(relPath: string) {
    if (!get().root) return;
    // Coalesce rapid touches (agent writing many files) into one refresh pass.
    touchQueue.set(relPath, Date.now());
    if (touchTimer !== null) window.clearTimeout(touchTimer);
    touchTimer = window.setTimeout(async () => {
      touchTimer = null;
      const paths = [...touchQueue.keys()];
      touchQueue.clear();
      if (paths.includes("*")) {
        await get().refreshAll();
        return;
      }
      const dirsToRefresh = new Set<string>();
      const expand = get().expanded;
      const setExpanded = { ...expand };
      for (const p of paths) {
        const segments = p.split("/");
        segments.pop();
        let acc = "";
        for (const seg of segments) {
          acc = acc ? `${acc}/${seg}` : seg;
          setExpanded[acc] = true;
        }
        const parent = segments.length ? segments.join("/") : ".";
        dirsToRefresh.add(parent);
      }
      set({ expanded: setExpanded });
      for (const dir of dirsToRefresh) {
        await get().refreshDir(dir);
      }
      const last = paths[paths.length - 1];
      set({ highlightPath: last });
      window.setTimeout(() => {
        set((s) => (s.highlightPath === last ? { highlightPath: null } : {}));
      }, 1600);
    }, 150);
  }
}));
