import { Code2, Diff, Eye, TerminalSquare, X } from "lucide-react";
import { useEditorStore } from "../stores/editorStore";
import { useUiStore } from "../stores/uiStore";
import { clsx } from "../stores/api";
import { CodeViewer } from "./CodeViewer";
import { DiffViewer } from "./DiffViewer";
import { TerminalView } from "./TerminalView";
import { PreviewView } from "./PreviewView";

const TABS = [
  { id: "code", label: "Code", icon: Code2 },
  { id: "diff", label: "Diff", icon: Diff },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "terminal", label: "Terminal", icon: TerminalSquare }
] as const;

export function WorkspacePanel() {
  const { panelTab, setPanelTab } = useUiStore();
  const { tabs: editorTabs, activePath, setActive, closeTab } = useEditorStore();
  const diff = useEditorStore((s) => s.diff);
  const hasConflict = editorTabs.some((t) => t.conflict);

  return (
    <div className="flex h-full w-full min-w-0 flex-col border-l border-edge bg-canvas">
      <div className="flex items-center border-b border-edge bg-panel/60">
        {editorTabs.length > 0 && (
          <div className="flex min-w-0 max-w-[55%] items-center overflow-x-auto">
            {editorTabs.map((t) => (
              <button
                key={t.path}
                className={clsx(
                  "group flex shrink-0 items-center gap-1.5 border-r border-edge px-2.5 py-1.5 text-xs",
                  activePath === t.path ? "bg-bg text-ink" : "text-muted hover:text-ink"
                )}
                title={t.path}
                onClick={() => {
                  setActive(t.path);
                  setPanelTab("code");
                }}
              >
                <span className="max-w-[120px] truncate">{t.path.split("/").pop()}</span>
                {t.conflict ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" title="conflict" />
                ) : t.dirty ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" title="unsaved" />
                ) : null}
                <span
                  className="rounded p-0.5 text-muted opacity-0 hover:text-ink group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.path);
                  }}
                >
                  <X className="h-3 w-3" />
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={clsx(
                "relative flex items-center gap-1.5 border-l border-edge px-3.5 py-2 text-xs transition-colors duration-200",
                panelTab === tab.id
                  ? "font-medium text-accent shadow-[inset_0_-2px_0_0_#d97757,0_-6px_18px_-8px_rgba(217,119,87,0.4)]"
                  : "text-muted hover:bg-panel2/40 hover:text-ink"
              )}
              onClick={() => setPanelTab(tab.id)}
              title={tab.label}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
              {tab.id === "diff" && diff && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              {tab.id === "code" && hasConflict && <span className="h-1.5 w-1.5 rounded-full bg-red-400" />}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {panelTab === "code" && <CodeViewer />}
        {panelTab === "diff" && <DiffViewer />}
        {panelTab === "preview" && <PreviewView />}
        {panelTab === "terminal" && <TerminalView />}
      </div>
    </div>
  );
}
