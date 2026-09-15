import { History, Zap } from "lucide-react";
import { useChatStore } from "../stores/chatStore";
import { useEditorStore } from "../stores/editorStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { clsx } from "../stores/api";

export function StatusBar() {
  const root = useWorkspaceStore((s) => s.root);
  const runningChats = useChatStore((s) => s.runningChats);
  const agents = Object.keys(runningChats).length;
  const usage = useChatStore((s) => (s.activeId ? s.chats[s.activeId]?.usage ?? null : null));
  const checkpoints = useChatStore((s) => (s.activeId ? s.chats[s.activeId]?.checkpointCount ?? 0 : 0));
  const indexProgress = useSettingsStore((s) => s.indexProgress);
  const vectorStats = useSettingsStore((s) => s.vectorStats);
  const providers = useSettingsStore((s) => s.providers);
  const settings = useSettingsStore((s) => s.settings);
  const saveState = useEditorStore((s) => s.saveState);
  const toast = useUiStore((s) => s.toast);
  const provider = settings?.activeProviderId ? providers.find((p) => p.id === settings.activeProviderId) : undefined;

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-edge bg-panel px-3 text-[11px] text-muted">
      <span className="flex items-center gap-1.5" title={agents > 0 ? `${agents} agent task(s) running` : "Agent idle"}>
        <span className={clsx("h-2 w-2 rounded-full", agents > 0 ? "pulse-dot bg-emerald-400" : "bg-muted/40")} />
        {agents > 1 ? `${agents} agents running` : agents === 1 ? "agent running" : "idle"}
      </span>
      <span className="truncate">{root ?? "no workspace"}</span>
      {checkpoints > 0 && (
        <span className="flex items-center gap-1 text-accent" title={`Time machine: ${checkpoints} checkpoint(s) available — restore any file-changing step from the chat timeline`}>
          <History className="h-3 w-3" /> {checkpoints}
        </span>
      )}
      {indexProgress && (
        <span className="flex items-center gap-1 text-accent" title="Building the semantic codebase index">
          <Zap className="h-3 w-3 animate-pulse" /> indexing {indexProgress.done}/{indexProgress.total || "…"}
        </span>
      )}
      <span className="ml-auto flex items-center gap-3">
        {(vectorStats?.files ?? 0) > 0 && <span className="text-muted/80">{vectorStats?.files} files indexed</span>}
        {usage?.model ? (
          <span className="flex items-center gap-1" title="Model used by the latest routed task">
            <Zap className="h-3 w-3 text-accent" />
            <span className="font-mono">{usage.model}</span>
          </span>
        ) : provider ? (
          <span className="flex items-center gap-1" title="Default provider">
            <Zap className="h-3 w-3 text-accent" />
            {provider.name} · <span className="font-mono">{provider.model}</span>
          </span>
        ) : (
          <span className="text-amber-400/90">no provider configured</span>
        )}
      </span>
      {saveState === "saving" && <span>saving…</span>}
      {saveState === "saved" && <span className="text-emerald-400">saved</span>}
      {saveState === "failed" && <span className="text-red-400">save failed</span>}
      {toast && (
        <span className={toast.type === "error" ? "max-w-[320px] truncate text-red-400" : "max-w-[320px] truncate"} title={toast.message}>
          {toast.message}
        </span>
      )}
    </footer>
  );
}
