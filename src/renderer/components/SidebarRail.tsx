import { ChevronsRight, FolderOpen, MessageSquarePlus, TerminalSquare } from "lucide-react";
import { useChatStore } from "../stores/chatStore";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";

export function SidebarRail() {
  const { toggleSidebar, setPanelTab } = useUiStore();
  const openViaDialog = useWorkspaceStore((s) => s.openViaDialog);
  const newChat = useChatStore((s) => s.newChat);
  return (
    <div className="flex h-full w-[52px] shrink-0 flex-col items-center gap-1 border-r border-edge bg-side py-2">
      <button className="rounded-md p-2 text-accent transition-colors duration-200 hover:bg-panel2" title="Expand explorer" onClick={toggleSidebar}>
        <ChevronsRight className="h-4 w-4" />
      </button>
      <button className="rounded-md p-2 text-muted transition-colors duration-200 hover:bg-panel2 hover:text-ink" title="Open workspace folder" onClick={() => void openViaDialog()}>
        <FolderOpen className="h-4 w-4" />
      </button>
      <button className="rounded-md p-2 text-muted transition-colors duration-200 hover:bg-panel2 hover:text-ink" title="New chat / parallel task" onClick={() => newChat()}>
        <MessageSquarePlus className="h-4 w-4" />
      </button>
      <button className="mt-auto rounded-md p-2 text-muted transition-colors duration-200 hover:bg-panel2 hover:text-ink" title="Terminal" onClick={() => setPanelTab("terminal")}>
        <TerminalSquare className="h-4 w-4" />
      </button>
    </div>
  );
}
