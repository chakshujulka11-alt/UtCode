import { FolderOpen, GitMerge, History, Layers, MessageSquarePlus, PanelLeft, PanelRight, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { clsx } from "../stores/api";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { WelcomeDashboard } from "./WelcomeDashboard";
import { MergeDialog } from "./MergeDialog";
import { ConfirmDialog } from "./ConfirmDialog";

export function ChatTabs() {
  const chats = useChatStore((s) => s.chats);
  const order = useChatStore((s) => s.order);
  const activeId = useChatStore((s) => s.activeId);
  const runningChats = useChatStore((s) => s.runningChats);
  const openChat = useChatStore((s) => s.openChat);
  const deleteChat = useChatStore((s) => s.deleteChat);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const tabs = order
    .map((id) => chats[id])
    .filter((c): c is NonNullable<typeof c> => !!c && !!c.id && (c.messages.length > 0 || c.id === activeId))
    .slice(0, 10);
  if (tabs.length <= 1) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-edge bg-side px-2 py-1">
      {tabs.map((c) => (
        <button
          key={c.id}
          className={clsx(
            "group flex max-w-[180px] shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors duration-200",
            c.id === activeId ? "border-edge bg-panel text-ink" : "border-transparent text-muted hover:bg-panel/60 hover:text-ink"
          )}
          onClick={() => void openChat(c.id)}
          title={c.title}
        >
          {runningChats[c.id] && <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
          <span className="truncate">{c.title}</span>
          <span
            className="rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmId(c.id);
            }}
          >
            <X className="h-2.5 w-2.5" />
          </span>
        </button>
      ))}
      <ConfirmDialog
        open={confirmId !== null}
        title="Delete this chat?"
        body="Are you sure you want to delete this chat? This will stop any running agents and cannot be undone."
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId) void deleteChat(confirmId);
          setConfirmId(null);
        }}
      />
    </div>
  );
}

function HeaderBar({ title }: { title?: string }) {
  const { toggleSidebar, toggleRight, rightOpen, isSidebarOpen } = useUiStore();
  const running = useChatStore((s) => s.running);
  const newTask = useChatStore((s) => s.newTask);
  const checkpointCount = useChatStore((s) => (s.activeId ? s.chats[s.activeId]?.checkpointCount ?? 0 : 0));
  const chats = useChatStore((s) => s.chats);
  const order = useChatStore((s) => s.order);
  const activeId = useChatStore((s) => s.activeId);
  const [mergeOpen, setMergeOpen] = useState(false);
  const activeRunId = activeId ? chats[activeId]?.checkpointRunId : undefined;
  const otherRuns = order
    .map((id) => chats[id])
    .filter((c) => c && c.id !== activeId && c.checkpointRunId && c.checkpointRunId !== activeRunId);
  const canMerge = !!activeRunId && otherRuns.length > 0;
  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-edge px-2">
      <button
        className="rounded p-1 text-muted transition-colors duration-200 hover:bg-panel2 hover:text-ink"
        title={isSidebarOpen ? "Hide explorer (Ctrl+B)" : "Show explorer (Ctrl+B)"}
        onClick={toggleSidebar}
      >
        <PanelLeft className="h-4 w-4" />
      </button>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink/90">{title ?? "Agent"}</span>
      {running && (
        <span className="flex items-center gap-1 text-xs text-accent">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" /> running
        </span>
      )}
      {checkpointCount > 0 && !running && (
        <button
          className="btn-ghost !px-2 !py-1 text-xs hover:!border-accent/60 hover:!text-accent"
          title={`Roll back ALL file changes the agent made in this session (${checkpointCount} checkpoints)`}
          onClick={() => void useChatStore.getState().rollbackAll()}
        >
          <History className="h-3.5 w-3.5" /> Rollback all
        </button>
      )}
      <button
        className="btn-ghost !px-2 !py-1 text-xs"
        onClick={() => void newTask()}
        title="New parallel task — start another agent while running ones keep going"
      >
        <Layers className="h-3.5 w-3.5" /> Parallel
      </button>
      {canMerge && (
        <button
          className="btn-accent-ghost !px-2 !py-1 text-xs"
          onClick={() => setMergeOpen(true)}
          title="Compare file changes between two finished tasks and merge per-file"
        >
          <GitMerge className="h-3.5 w-3.5" /> Merge
        </button>
      )}
      <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void newTask()} title="New conversation">
        <MessageSquarePlus className="h-3.5 w-3.5" /> New
      </button>
      <button
        className="rounded p-1 text-muted transition-colors duration-200 hover:bg-panel2 hover:text-ink"
        title={rightOpen ? "Hide workspace (Ctrl+J)" : "Show workspace (Ctrl+J)"}
        onClick={toggleRight}
      >
        <PanelRight className="h-4 w-4" />
      </button>
      {mergeOpen && activeRunId && (
        <MergeDialog
          runA={activeRunId}
          titleA={title ?? "current task"}
          candidates={otherRuns.map((c) => ({ chatId: c.id, runId: c.checkpointRunId!, title: c.title }))}
          onClose={() => setMergeOpen(false)}
        />
      )}
    </div>
  );
}

function EmptyState() {
  const { root, openViaDialog } = useWorkspaceStore();
  const providers = useSettingsStore((s) => s.providers);
  const hasProvider = providers.some((p) => p.enabled);

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent">
        <Sparkles className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold text-ink">Give utcode a coding task</h2>
      <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">
        The agent inspects your project, edits files, runs terminal commands and keeps working until the task is done.
      </p>
      <div className="mt-5 flex flex-col gap-2 text-sm">
        {!root && (
          <button className="btn-accent-ghost justify-center hover:shadow-[0_2px_16px_rgba(217,119,87,0.25)]" onClick={() => void openViaDialog()}>
            <FolderOpen className="h-4 w-4" /> Choose a workspace folder
          </button>
        )}
        {!hasProvider && (
          <p className="text-xs text-muted">
            No AI provider yet — open the sidebar (top-left) and go to <span className="text-ink/80">Settings → Providers</span>.
          </p>
        )}
      </div>
    </div>
  );
}

export function ChatView() {
  const { chats, activeId, running, error } = useChatStore();
  const active = activeId ? chats[activeId] : null;

  // Null-safety: deleted-last-chat / stale id must render the dashboard, never crash.
  if (!activeId || !active) {
    return <WelcomeDashboard />;
  }

  if (active.messages.length === 0) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-canvas">
        <HeaderBar />
        <EmptyState />
        <Composer />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-canvas">
      <HeaderBar title={active.title} />
      {error && !running && (
        <div className="mx-4 mt-2 rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-[13px] text-red-300">
          {error}
        </div>
      )}
      <MessageList key={active.id} messages={active.messages} />
      <Composer />
    </div>
  );
}
