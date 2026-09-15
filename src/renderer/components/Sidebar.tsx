import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  Clock,
  FileCode2,
  FolderOpen,
  FolderPlus,
  Layers,
  MessageSquare,
  Plus,
  Settings,
  Trash2,
  X,
  Files
} from "lucide-react";
import { useEditorStore } from "../stores/editorStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useChatStore } from "../stores/chatStore";
import { useUiStore } from "../stores/uiStore";
import { clsx } from "../stores/api";
import { FileTree } from "./FileTree";
import { UtcodeLogo } from "./UtcodeLogo";
import { ConfirmDialog } from "./ConfirmDialog";

function basename(p: string): string {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;
}

function Section({
  icon,
  label,
  children,
  action
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-4 border-t border-edge/50 pt-4">
      <div className="mb-1 flex items-center gap-1 px-1">
        <button
          className="section-label flex-1 text-left hover:text-ink"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {icon}
          {label}
        </button>
        {action}
      </div>
      {open && <div className="min-w-0">{children}</div>}
    </div>
  );
}

function ChatListSection() {
  const chats = useChatStore((s) => s.chats);
  const order = useChatStore((s) => s.order);
  const activeId = useChatStore((s) => s.activeId);
  const openChat = useChatStore((s) => s.openChat);
  const deleteChat = useChatStore((s) => s.deleteChat);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const chatList = order.map((id) => chats[id]).filter((c): c is NonNullable<typeof c> => !!c && !!c.id && c.messages.length > 0).slice(0, 12);
  if (chatList.length === 0) return <div className="px-1 py-1 text-xs text-muted">No conversations yet.</div>;
  return (
    <>
      {chatList.map((c) => (
        <button
          key={c.id}
          className={clsx(
            "group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors duration-200",
            activeId === c.id ? "bg-panel2 text-ink" : "text-ink/75 hover:bg-panel2/60"
          )}
          onClick={() => void openChat(c.id)}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted" />
          <span className="flex-1 truncate">{c.title}</span>
          {(c.checkpointCount ?? 0) > 0 && (
            <span className="shrink-0 text-[9px] text-accent" title={`${c.checkpointCount} checkpoints`}>⏱</span>
          )}
          <span
            className="rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmId(c.id);
            }}
          >
            <Trash2 className="h-3 w-3" />
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
    </>
  );
}

export function Sidebar() {
  const { root, recent, openViaDialog, openPath, busy } = useWorkspaceStore();
  const { tabs, activePath, closeTab, openFile, saveActive } = useEditorStore();
  const { toggleSidebar, setSettingsOpen, sidebarWidth } = useUiStore();

  const newProject = async (): Promise<void> => {
    const opened = await openViaDialog();
    if (opened) useChatStore.getState().newChat();
  };

  return (
    <aside className="flex h-full shrink-0 flex-col border-r border-edge bg-side" style={{ width: sidebarWidth }}>
      <div className="flex items-center gap-2 px-3 pb-1 pt-3">
        <UtcodeLogo size={22} />
        <span className="text-[17px] font-bold tracking-tight text-ink">
          ut<span className="text-accent">code</span>
        </span>
        <button
          title="Collapse sidebar (Ctrl+B)"
          className="ml-auto rounded-md p-1.5 text-muted transition-colors duration-200 hover:bg-panel2 hover:text-ink"
          onClick={toggleSidebar}
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="px-3 pb-1 pt-2">
        <button className="btn-primary w-full justify-center !rounded-lg shadow-[0_2px_14px_rgba(217,119,87,0.25)] transition-all duration-200 hover:shadow-[0_4px_24px_rgba(217,119,87,0.45)]" disabled={busy} onClick={() => void newProject()}>
          <FolderPlus className="h-4 w-4" /> {busy ? "Opening…" : "New project"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-2">
        <div className="mt-3">
          <div className="label mb-1">Workspace</div>
          {root ? (
            <div
              className="group flex items-center justify-between gap-1 rounded-lg border border-edge bg-panel px-2.5 py-1.5"
              title={root}
            >
              <span className="truncate text-[13px] text-ink">{basename(root)}</span>
              <button
                className="rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                title="Open another folder"
                onClick={() => void openViaDialog()}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge bg-panel/40 px-3 py-6 text-center">
              <FolderOpen className="h-6 w-6 text-muted" />
              <p className="text-xs text-muted">Open a folder to browse your project</p>
              <button className="btn-accent-ghost !px-3 !py-1 text-xs" disabled={busy} onClick={() => void openViaDialog()}>
                Choose Folder
              </button>
            </div>
          )}
        </div>

        <Section icon={<Files className="h-3 w-3" />} label="Files">
          {root ? <FileTree /> : null}
        </Section>

        {tabs.length > 0 && (
          <Section icon={<FileCode2 className="h-3 w-3" />} label="Open files">
            {tabs.map((t) => (
              <button
                key={t.path}
                className={clsx(
                  "group flex w-full items-center gap-1.5 rounded-md px-1.5 py-[3px] text-left text-[13px] transition-colors duration-200",
                  activePath === t.path ? "bg-panel2 text-ink" : "text-ink/75 hover:bg-panel2/60"
                )}
                title={`${t.path}${t.dirty ? " (unsaved)" : ""}`}
                onClick={() => void openFile(t.path)}
              >
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="flex-1 truncate">{basename(t.path)}</span>
                {t.conflict && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" title="conflict" />}
                {t.dirty && !t.conflict && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="unsaved" />}
                <span
                  className="rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.path);
                  }}
                >
                  <X className="h-3 w-3" />
                </span>
              </button>
            ))}
            <button className="mt-1 w-full rounded-md border border-edge px-2 py-1 text-xs text-muted transition-colors duration-200 hover:border-accent/40 hover:text-ink" onClick={() => void saveActive()}>
              Save active file (Ctrl+S)
            </button>
          </Section>
        )}

        <Section
          icon={<MessageSquare className="h-3 w-3" />}
          label="Chats"
          action={
            <span className="flex items-center gap-0.5">
              <button
                className="rounded p-0.5 text-muted transition-colors duration-200 hover:text-accent"
                title="New parallel task — another agent can run at the same time (up to 3)"
                onClick={() => void useChatStore.getState().newTask()}
              >
                <Layers className="h-3.5 w-3.5" />
              </button>
              <button
                className="rounded p-0.5 text-muted transition-colors duration-200 hover:text-accent"
                title="New chat"
                onClick={() => void useChatStore.getState().newTask()}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </span>
          }
        >
          <ChatListSection />
        </Section>

        {recent.length > 0 && (
          <Section icon={<Clock className="h-3 w-3" />} label="Recent">
            {recent.map((r) => (
              <button
                key={r}
                className="w-full truncate rounded-md px-1.5 py-[3px] text-left text-[12px] text-muted transition-colors duration-200 hover:bg-panel2 hover:text-ink"
                title={r}
                onClick={() => void openPath(r)}
              >
                {basename(r)}
              </button>
            ))}
          </Section>
        )}
      </div>

      <div className="border-t border-edge px-2 py-2">
        <button
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted transition-colors duration-200 hover:bg-panel2 hover:text-white"
          title="Settings (Ctrl+,)"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-4 w-4" /> Settings
        </button>
      </div>
    </aside>
  );
}
