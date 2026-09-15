import { create } from "zustand";
import type { AgentEvent, Chat, ChatMessage } from "../../shared/types";
import { api, call, uid } from "./api";
import { useEditorStore } from "./editorStore";
import { useSettingsStore } from "./settingsStore";
import { useWorkspaceStore } from "./workspaceStore";

function currentModelMeta(): string | undefined {
  const st = useSettingsStore.getState();
  const activeId = st.settings?.activeProviderId ?? st.settings?.defaultProviderId;
  const p = st.providers.find((x) => x.id === activeId) ?? st.providers.find((x) => x.enabled);
  return p ? `${p.name} · ${p.model}` : undefined;
}

interface ChatState {
  chats: Record<string, Chat>;
  order: string[];
  activeId: string | null;
  running: boolean;
  runningChats: Record<string, string>;
  runningChatId: string | null;
  runId: string | null;
  error: string | null;
  init(): Promise<void>;
  newChat(): string;
  newTask(): Promise<string | null>;
  openChat(id: string): Promise<void>;
  select(id: string): void;
  deleteChat(id: string): Promise<void>;
  send(text: string): Promise<void>;
  stop(chatId?: string): Promise<void>;
  restoreTo(runId: string, callId: string, resume: boolean, chatId?: string): Promise<void>;
  rollbackAll(): Promise<void>;
  handleEvent(event: AgentEvent): void;
}

let persistTimer: number | null = null;
let lastActivityAt = Date.now();

export function getAgentLastActivity(): number {
  return lastActivityAt;
}

export function touchAgentActivity(): void {
  lastActivityAt = Date.now();
}

function schedulePersist(get: () => ChatState, set: (fn: (s: ChatState) => Partial<ChatState>) => void): void {
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    const state = get();
    const chat = state.activeId ? state.chats[state.activeId] : null;
    if (chat && chat.messages.length > 0 && !chat.messages.some((m) => m.streaming)) {
      const snap = useEditorStore.getState().snapshot();
      const withSnapshot: Chat = { ...chat, openFiles: snap.openFiles, activeFile: snap.activeFile, workspaceRoot: useWorkspaceStore.getState().root ?? chat.workspaceRoot };
      void call(api.utcode.chatSave(withSnapshot)).then((list) => {
        set((s) => {
          const chats = { ...s.chats };
          for (const c of list) chats[c.id] = c; // update/insert from server, never wipe local-only chats
          const order = [...new Set([...s.order.filter((cid) => chats[cid]), ...list.map((c) => c.id)])].filter(
            (cid) => !!chats[cid]
          );
          return { chats, order };
        });
      }).catch(() => undefined);
    }
  }, 800);
}

function indexChats(chats: Chat[]): Record<string, Chat> {
  const out: Record<string, Chat> = {};
  for (const c of chats) out[c.id] = c;
  return out;
}

function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 48 ? clean : clean.slice(0, 48) + "…";
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: {},
  order: [],
  activeId: null,
  running: false,
  runningChats: {},
  runningChatId: null,
  runId: null,
  error: null,

  async init() {
    try {
      const chats = await call(api.utcode.chatList());
      set({ chats: indexChats(chats), order: chats.map((c) => c.id) });
    } catch {
      /* offline first run */
    }
  },

  newChat() {
    const id = uid();
    const chat: Chat = {
      id,
      title: "New chat",
      workspaceRoot: useWorkspaceStore.getState().root,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
    set((s) => ({ chats: { ...s.chats, [id]: chat }, activeId: id, order: [id, ...s.order.filter((x) => x !== id)] }));
    return id;
  },

  /** Spec 2.3: creating a chat with NO workspace opens the folder picker FIRST. */
  async newTask() {
    const ws = useWorkspaceStore.getState();
    if (!ws.root) {
      const opened = await ws.openViaDialog();
      if (!opened) return null;
    }
    const id = get().newChat();
    set((s) => ({ chats: { ...s.chats, [id]: { ...s.chats[id], workspaceRoot: useWorkspaceStore.getState().root } } }));
    return id;
  },

  /** Spec 2.2: clicking a chat restores its workspace, file tree, open tabs and scroll. */
  async openChat(id: string) {
    const state = get();
    const chat = state.chats[id];
    if (!chat) {
      set({ activeId: id });
      return;
    }
    const prevId = state.activeId;
    if (prevId && prevId !== id && state.chats[prevId]) {
      const snap = useEditorStore.getState().snapshot();
      set((s) => {
        const prev = s.chats[prevId];
        if (!prev) return {};
        return { chats: { ...s.chats, [prevId]: { ...prev, openFiles: snap.openFiles, activeFile: snap.activeFile, updatedAt: Date.now() } } };
      });
      schedulePersist(get, set);
    }
    set({ activeId: id });
    const currentRoot = useWorkspaceStore.getState().root;
    if (chat.workspaceRoot && chat.workspaceRoot !== currentRoot) {
      try {
        await useWorkspaceStore.getState().openPath(chat.workspaceRoot);
      } catch {
        /* toast shown by openPath; continue with restore of what we can */
      }
    }
    await useEditorStore.getState().restoreForChat(chat.openFiles ?? [], chat.activeFile ?? null, chat.id);
  },

  select(id: string) {
    set({ activeId: id });
  },

  async deleteChat(id: string) {
    // 1. Stop any agent attached to this chat FIRST (kills model request + its terminals),
    //    otherwise it becomes a zombie writing events to a destroyed chat.
    const runId = get().runningChats[id];
    if (runId && runId !== "pending") {
      try {
        await call(api.utcode.agentCancel(runId));
      } catch {
        /* best effort — local cleanup below still happens */
      }
    }
    // 2. Immutable, chat-scoped removal. Never replace the whole record with the
    //    server list here: unsaved/running chats only live in memory and that is
    //    what caused "delete one, lose all".
    set((s) => {
      const chats = { ...s.chats };
      delete chats[id];
      const runningChats = { ...s.runningChats };
      delete runningChats[id];
      const order = s.order.filter((x) => x !== id);
      let activeId = s.activeId === id ? null : s.activeId;
      if (!activeId) activeId = order.find((x) => chats[x]) ?? null;
      return {
        chats,
        order,
        runningChats,
        running: Object.keys(runningChats).length > 0,
        runningChatId: s.runningChatId === id ? null : s.runningChatId,
        activeId
      };
    });
    // 3. Remove from the durable store and merge back only what the server still
    //    knows about (additive), never overwriting local-only chats.
    void call(api.utcode.chatDelete(id))
      .then((list) => {
        set((s) => {
          const chats = { ...s.chats };
          for (const c of list) {
            if (c.id !== id && !chats[c.id]) chats[c.id] = c;
          }
          const order = [...new Set([...list.filter((c) => c.id !== id).map((c) => c.id), ...s.order])].filter(
            (cid) => cid !== id && !!chats[cid]
          );
          return { chats, order };
        });
      })
      .catch(() => undefined);
  },

  async send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    set({ error: null });
    let id = get().activeId;
    if (!id || !get().chats[id]) id = get().newChat();
    if (get().runningChats[id]) return;
    const assistantId = uid();
    const userMsg: ChatMessage = { id: uid(), role: "user", text: trimmed, createdAt: Date.now() };
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      toolEvents: [],
      createdAt: Date.now(),
      streaming: true,
      meta: currentModelMeta()
    };
    set((s) => {
      const chat = s.chats[id!];
      const updated: Chat = {
        ...chat,
        title: chat.messages.length === 0 ? titleFrom(trimmed) : chat.title,
        workspaceRoot: useWorkspaceStore.getState().root ?? chat.workspaceRoot,
        updatedAt: Date.now(),
        messages: [...chat.messages, userMsg, assistantMsg]
      };
      return {
        chats: { ...s.chats, [id!]: updated },
        order: s.order.includes(id!) ? s.order : [id!, ...s.order],
        running: true,
        runningChatId: id!,
        runningChats: { ...s.runningChats, [id!]: "pending" }
      };
    });
    try {
      const runId = await call(api.utcode.agentRun(trimmed, id));
      set((s) => {
        if (!s.chats[id!]) {
          // chat was deleted while the run was starting — do not resurrect bookkeeping
          void call(api.utcode.agentCancel(runId)).catch(() => undefined);
          return {};
        }
        return { runId, runningChats: { ...s.runningChats, [id!]: runId } };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => {
        const chat = s.chats[id!];
        const messages = chat.messages.map((m) =>
          m.id === assistantId ? { ...m, streaming: false, status: "error" as const, text: m.text || `⚠ ${message}` } : m
        );
        const rc = { ...s.runningChats };
        delete rc[id!];
        return {
          running: Object.keys(rc).length > 0,
          runningChatId: s.runningChatId === id ? null : s.runningChatId,
          runningChats: rc,
          error: message,
          chats: { ...s.chats, [id!]: { ...chat, messages, updatedAt: Date.now() } }
        };
      });
      schedulePersist(get, set);
    }
  },

  async stop(chatId?: string) {
    const s = get();
    const id = chatId ?? s.activeId;
    const runId = id ? s.runningChats[id] : undefined;
    try {
      if (runId && runId !== "pending") await call(api.utcode.agentCancel(runId));
      else if (s.running) await call(api.utcode.agentCancel());
    } catch {
      /* ignore */
    }
  },

  async restoreTo(runId, callId, resume, chatId) {
    const id = chatId ?? get().activeId;
    if (!id) return;
    if (resume) {
      const placeholder: ChatMessage = {
        id: uid(),
        role: "assistant",
        text: "",
        toolEvents: [],
        createdAt: Date.now(),
        streaming: true
      };
      set((s) => {
        const c = s.chats[id];
        return {
          running: true,
          runningChatId: id,
          runningChats: { ...s.runningChats, [id]: "pending" },
          chats: { ...s.chats, [id]: { ...c, messages: [...c.messages, placeholder], updatedAt: Date.now() } }
        };
      });
      touchAgentActivity();
    }
    try {
      const res = await call(api.utcode.agentRestore(runId, callId, resume));
      set((s) => {
        const c = s.chats[id];
        const note = `⏪ Time machine: restored ${res.restoredFiles.length} file(s) to before that step. ${res.remainingCheckpoints} checkpoint(s) left.${res.resumed ? " Re-running the agent from that moment…" : ""}`;
        let messages = c.messages.map((m) =>
          m.role === "assistant" && (m.toolEvents ?? []).some((ev) => ev.callId === callId)
            ? { ...m, toolEvents: [...(m.toolEvents ?? []), { kind: "state" as const, runId: "checkpoint", timestamp: Date.now(), text: note }] }
            : m
        );
        const rc = { ...s.runningChats };
        if (resume) {
          if (res.newRunId) rc[id] = res.newRunId;
        } else {
          delete rc[id];
          messages = messages.map((m) => (m.streaming && m.id !== undefined ? m : m));
        }
        return {
          running: Object.keys(rc).length > 0,
          runningChats: rc,
          runningChatId: resume ? id : s.runningChatId === id ? null : s.runningChatId,
          chats: {
            ...s.chats,
            [id]: {
              ...c,
              messages,
              updatedAt: Date.now(),
              checkpointRunId: resume ? res.newRunId ?? c.checkpointRunId : c.checkpointRunId,
              checkpointCount: res.remainingCheckpoints
            }
          }
        };
      });
      if (!resume) schedulePersist(get, set);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => {
        const c = s.chats[id];
        const messages = c.messages.map((m) =>
          m.streaming ? { ...m, streaming: false, status: "error" as const, text: m.text || `⚠ ${message}` } : m
        );
        return { running: false, chats: { ...s.chats, [id]: { ...c, messages } } };
      });
    }
  },

  async rollbackAll() {
    const state = get();
    const id = state.activeId;
    if (!id) return;
    const runId = state.chats[id]?.checkpointRunId;
    if (!runId) return;
    await state.restoreTo(runId, "__all__", false);
  },

  handleEvent(event: AgentEvent) {
    touchAgentActivity();
    if (event.kind === "index" || event.runId === "indexer") return;
    const state = get();
    if (event.runId === "system" || event.kind === "mcp_event") return;

    // Orphan guard: an event for a chat that no longer exists must never create a
    // new chat or keep a zombie running count. Drop it and clean the bookkeeping.
    if (event.chatId && !state.chats[event.chatId]) {
      set((s) => {
        if (!s.runningChats[event.chatId!]) return {};
        const rc = { ...s.runningChats };
        delete rc[event.chatId!];
        return { runningChats: rc, running: Object.keys(rc).length > 0, runningChatId: s.runningChatId === event.chatId ? null : s.runningChatId };
      });
      return;
    }

    let id = event.chatId ?? state.runningChatId ?? state.activeId;
    if (!id) {
      id = state.newChat();
      set({ runningChatId: id });
    }
    const chat = state.chats[id];
    if (!chat) return;
    const last = chat.messages[chat.messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const assistantId = last.id;

    const patch = (mut: (m: ChatMessage) => ChatMessage, extra: Partial<ChatState> = {}): void => {
      set((s) => {
        const c = s.chats[id!];
        const messages = c.messages.map((m) => (m.id === assistantId ? mut(m) : m));
        return {
          ...extra,
          chats: { ...s.chats, [id!]: { ...c, messages, updatedAt: Date.now() } }
        };
      });
    };

    switch (event.kind) {
      case "text_delta":
        patch((m) => ({ ...m, text: m.text + (event.text ?? "") }));
        break;
      case "agent_started":
        patch((m) => ({
          ...m,
          toolEvents: [...(m.toolEvents ?? []), { ...event, kind: "thinking" as const, text: event.text ?? "Starting…" }]
        }));
        break;
      case "thinking":
      case "tool_started":
      case "tool_result":
      case "error":
      case "file_changed":
        if (event.kind === "file_changed") {
          // disk/agent file changes update the editor + tree, but never pollute the timeline
          if (event.path) useEditorStore.getState().applyFileChangedFromAgent(event);
          break;
        }
        patch((m) => {
          const events = m.toolEvents ?? [];
          if (
            event.kind === "tool_result" &&
            events.length > 0 &&
            events[events.length - 1].kind === "tool_started" &&
            events[events.length - 1].callId === event.callId
          ) {
            const merged: AgentEvent = { ...events[events.length - 1], kind: "tool_result", ok: event.ok, durationMs: event.durationMs, result: event.result };
            return { ...m, toolEvents: [...events.slice(0, -1), merged] };
          }
          return { ...m, toolEvents: [...events, event] };
        });
        break;
      case "checkpoint":
        set((s) => {
          const c = s.chats[id!];
          return {
            chats: {
              ...s.chats,
              [id!]: { ...c, checkpointRunId: event.runId, checkpointCount: typeof event.remaining === "number" ? event.remaining : (c.checkpointCount ?? 0) + 1 }
            }
          };
        });
        break;
      case "usage": {
        set((s) => {
          const c = s.chats[id!];
          return {
            chats: {
              ...s.chats,
              [id!]: {
                ...c,
                usage: {
                  promptTokens: event.promptTokens ?? c.usage?.promptTokens ?? 0,
                  completionTokens: event.completionTokens ?? c.usage?.completionTokens ?? 0,
                  costUsd: event.costUsd ?? c.usage?.costUsd ?? 0,
                  contextPct: event.contextPct ?? c.usage?.contextPct,
                  estimated: event.estimated ?? c.usage?.estimated,
                  model: event.model ?? c.usage?.model
                },
                totalTokens: (event.promptTokens ?? 0) + (event.completionTokens ?? 0) > 0
                  ? (event.promptTokens ?? c.usage?.promptTokens ?? 0) + (event.completionTokens ?? c.usage?.completionTokens ?? 0)
                  : c.totalTokens ?? 0
              }
            }
          };
        });
        break;
      }
      case "agent_finished": {
        const status = event.status === "cancelled" ? "cancelled" : event.status === "error" ? "error" : "ok";
        set((s) => {
          const rc = { ...s.runningChats };
          delete rc[id!];
          return { running: Object.keys(rc).length > 0, runId: null, runningChatId: s.runningChatId === id ? null : s.runningChatId, runningChats: rc };
        });
        patch(
          (m) => ({
            ...m,
            streaming: false,
            status,
            text: m.text || event.text || "(The agent finished without a written summary — check its tool cards above, or send “continue”.)",
            toolEvents: [...(m.toolEvents ?? []), { ...event, kind: "state" as const, text: `Finished: ${event.status ?? "completed"}` }]
          })
        );
        schedulePersist(get, set);
        break;
      }
      default:
        break;
    }
  }
}));
