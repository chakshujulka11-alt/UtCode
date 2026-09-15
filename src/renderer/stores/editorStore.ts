import { create } from "zustand";
import type { AgentEvent, FileContent } from "../../shared/types";
import { api, call } from "./api";
import { useUiStore } from "./uiStore";

export interface EditorTab {
  path: string;
  content: string;
  savedContent: string;
  language: string;
  dirty: boolean;
  loading: boolean;
  binary: boolean;
  truncated: boolean;
  agentModified: boolean;
  streamProgress: number | null;
  conflict: { diskContent: string; summary: string } | null;
}

export interface DiffState {
  path: string;
  before: string;
  after: string;
  summary: string;
}

interface EditorState {
  tabs: EditorTab[];
  activePath: string | null;
  diff: DiffState | null;
  saveState: "idle" | "saving" | "saved" | "failed";
  saveError: string | null;
  restoring: boolean;
  openFile(path: string, opts?: { silent?: boolean }): Promise<void>;
  snapshot(): { openFiles: string[]; activeFile: string | null };
  restoreForChat(paths: string[], active: string | null, chatKey: string): Promise<void>;
  closeTab(path: string): void;
  setActive(path: string): void;
  updateContent(path: string, content: string): void;
  saveActive(): Promise<void>;
  applyFileChangedFromAgent(event: AgentEvent): void;
  resolveConflictUseDisk(path: string): void;
  resolveConflictKeepMine(path: string): void;
  openDiffFor(path: string): void;
  revertDiff(): Promise<void>;
  reloadFromDisk(path: string): Promise<void>;
  refreshAfterExternalChange(): Promise<void>;
}

function makeTab(file: FileContent): EditorTab {
  return {
    path: file.path,
    content: file.content,
    savedContent: file.content,
    language: file.language ?? plaintext(file.path),
    dirty: false,
    loading: false,
    binary: file.encoding === "binary",
    truncated: file.truncated,
    agentModified: false,
    streamProgress: null,
    conflict: null
  };
}

const STREAM_CAP_BYTES = 8 * 1024 * 1024;
const activeStreams = new Map<string, { id: string; unsub: () => void }>();

function plaintext(path: string): string {
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".json")) return "json";
  return "plaintext";
}

async function streamIntoTab(path: string, fullSize: number): Promise<void> {
  const existing = activeStreams.get(path);
  if (existing) {
    existing.unsub();
    void call(api.utcode.fileStreamAbort(existing.id)).catch(() => undefined);
  }
  try {
    const start = await call(api.utcode.fileReadStreamStart(path));
    let acc = "";
    let lastPct = 0;
    const unsub = api.utcode.onFileStreamChunk((evt) => {
      if (evt.id !== start.id) return;
      if (evt.chunk) acc += evt.chunk;
      if (evt.done) {
        unsub();
        activeStreams.delete(path);
        useEditorStore.setState((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.path !== path) return t;
            const complete = acc.length >= fullSize;
            if (t.dirty) {
              // user edited while streaming — keep their text, remember disk truth for diff
              return { ...t, savedContent: acc || t.savedContent, truncated: !complete, streamProgress: null };
            }
            return {
              ...t,
              content: acc || t.content,
              savedContent: acc || t.savedContent,
              truncated: !complete,
              streamProgress: null
            };
          })
        }));
        return;
      }
      const pct = Math.max(evt.progress, Math.min(99, Math.round((acc.length / Math.max(1, fullSize)) * 100)));
      if (pct - lastPct >= 5) {
        lastPct = pct;
        useEditorStore.setState((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, streamProgress: Math.min(99, pct) } : t)) }));
      }
    });
    activeStreams.set(path, { id: start.id, unsub });
  } catch {
    /* streaming unavailable — truncated view remains */
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activePath: null,
  diff: null,
  saveState: "idle",
  saveError: null,
  restoring: false,

  async openFile(path: string, opts?: { silent?: boolean }) {
    const existing = get().tabs.find((t) => t.path === path);
    if (existing) {
      set({ activePath: path });
      return;
    }
    const placeholder: EditorTab = {
      path,
      content: "",
      savedContent: "",
      language: plaintext(path),
      dirty: false,
      loading: true,
      binary: false,
      truncated: false,
      agentModified: false,
      streamProgress: null,
      conflict: null
    };
    set((s) => ({ tabs: [...s.tabs, placeholder], activePath: path }));
    try {
      const file = await call(api.utcode.readFile(path));
      set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? makeTab(file) : t)) }));
      useUiStore.getState().setPanelTab("code");
      // Large text files: upgrade the truncated view by streaming the real content.
      if (file.truncated && file.encoding === "utf-8" && file.size <= STREAM_CAP_BYTES) {
        void streamIntoTab(path, file.size);
      }
    } catch (err) {
      set((s) => ({ tabs: s.tabs.filter((t) => t.path !== path), activePath: s.tabs.find((t) => t.path !== path)?.path ?? null }));
      if (!opts?.silent) useUiStore.getState().toastMessage(err instanceof Error ? err.message : String(err), "error");
    }
  },

  snapshot() {
    const s = get();
    return { openFiles: s.tabs.map((t) => t.path), activeFile: s.activePath };
  },

  /** Restore a chat's tabs without losing unsaved edits: keep wanted + all dirty tabs, drop only clean unrelated ones. */
  async restoreForChat(paths: string[], active: string | null, _chatKey: string) {
    const s = get();
    const wanted = new Set(paths);
    const keepDirtyForeign = s.tabs.filter((t) => !wanted.has(t.path) && t.dirty);
    set((st) => ({
      tabs: st.tabs.filter((t) => wanted.has(t.path)),
      restoring: true
    }));
    for (const p of paths) {
      try {
        await get().openFile(p, { silent: true });
      } catch {
        /* file may no longer exist after a workspace switch */
      }
    }
    if (keepDirtyForeign.length) {
      set((st) => {
        const merged = [...st.tabs];
        for (const t of keepDirtyForeign) if (!merged.some((m) => m.path === t.path)) merged.push(t);
        return { tabs: merged };
      });
    }
    if (active && get().tabs.some((t) => t.path === active)) set({ activePath: active });
    set({ restoring: false });
  },

  closeTab(path: string) {
    const st = activeStreams.get(path);
    if (st) {
      st.unsub();
      activeStreams.delete(path);
      void call(api.utcode.fileStreamAbort(st.id)).catch(() => undefined);
    }
    set((s) => {
      const tabs = s.tabs.filter((t) => t.path !== path);
      const activePath = s.activePath === path ? tabs[tabs.length - 1]?.path ?? null : s.activePath;
      return { tabs, activePath };
    });
  },

  setActive(path: string) {
    set({ activePath: path });
  },

  updateContent(path: string, content: string) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, content, dirty: content !== t.savedContent } : t))
    }));
  },

  async saveActive() {
    const { activePath, tabs } = get();
    const tab = tabs.find((t) => t.path === activePath);
    if (!tab || !tab.dirty) return;
    set({ saveState: "saving", saveError: null });
    try {
      await call(api.utcode.writeFile(tab.path, tab.content));
      useUiStore.getState().bumpPreview();
      set((s) => ({
        tabs: s.tabs.map((t) => (t.path === tab.path ? { ...t, savedContent: t.content, dirty: false, agentModified: false } : t)),
        saveState: "saved"
      }));
      window.setTimeout(() => set({ saveState: "idle" }), 1200);
    } catch (err) {
      set({ saveState: "failed", saveError: err instanceof Error ? err.message : String(err) });
    }
  },

  applyFileChangedFromAgent(event: AgentEvent) {
    if (!event.path) return;
    const { tabs } = get();
    const tab = tabs.find((t) => t.path === event.path);
    if (!tab) {
      if (event.after !== undefined) {
        set({
          diff: {
            path: event.path,
            before: event.before ?? "",
            after: event.after,
            summary: event.summary ?? "changed"
          }
        });
      }
      return;
    }
    if (tab.dirty && tab.content !== tab.savedContent) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.path === event.path
            ? {
                ...t,
                agentModified: true,
                conflict: { diskContent: event.after ?? t.content, summary: event.summary ?? "agent modified file" }
              }
            : t
        )
      }));
      get().openDiffFor(event.path);
      return;
    }
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === event.path
          ? { ...t, content: event.after ?? t.content, savedContent: event.after ?? t.savedContent, dirty: false, agentModified: true }
          : t
      )
    }));
    get().openDiffFor(event.path);
  },

  resolveConflictUseDisk(path: string) {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.conflict
          ? { ...t, content: t.conflict.diskContent, savedContent: t.conflict.diskContent, dirty: false, conflict: null }
          : t
      )
    }));
  },

  resolveConflictKeepMine(path: string) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, conflict: null } : t)) }));
  },

  openDiffFor(path: string) {
    const tab = get().tabs.find((t) => t.path === path);
    if (!tab) return;
    useUiStore.getState().setPanelTab("diff");
    set({
      diff: {
        path,
        before: tab.savedContent,
        after: tab.content,
        summary: tab.conflict?.summary ?? "unsaved changes"
      }
    });
  },

  async revertDiff() {
    const { diff, tabs } = get();
    if (!diff) return;
    try {
      await call(api.utcode.writeFile(diff.path, diff.before));
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.path === diff.path ? { ...t, content: diff.before, savedContent: diff.before, dirty: false, agentModified: false, conflict: null } : t
        ),
        diff: tabs.some((t) => t.path === diff.path && t.dirty) ? null : s.diff
      }));
      useUiStore.getState().toastMessage(`Reverted ${diff.path}`, "info");
    } catch (err) {
      useUiStore.getState().toastMessage(err instanceof Error ? err.message : String(err), "error");
    }
  },

  async reloadFromDisk(path: string) {
    try {
      const file = await call(api.utcode.readFile(path));
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.path === path && !t.dirty ? makeTab(file) : t.path === path ? { ...t, conflict: { diskContent: file.content, summary: "file changed on disk" } } : t
        )
      }));
    } catch {
      /* file may have been deleted */
    }
  },

  async refreshAfterExternalChange() {
    const dirty = get().tabs.filter((t) => !t.dirty);
    for (const tab of dirty) {
      await get().reloadFromDisk(tab.path);
    }
  }
}));
