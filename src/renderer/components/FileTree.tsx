import { memo } from "react";
import { ChevronRight, FileCode2, FileJson, FileText, FileType, Folder, FolderOpen, Image, Loader2, ScanText } from "lucide-react";
import type { WorkspaceFileInfo } from "../../shared/types";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useEditorStore } from "../stores/editorStore";
import { clsx } from "../stores/api";

function iconFor(file: WorkspaceFileInfo): React.ReactNode {
  if (file.type === "directory") return undefined;
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const cls = "h-3.5 w-3.5 shrink-0";
  if ([".ts", ".tsx"].includes(ext)) return <FileCode2 className={clsx(cls, "text-[#4f9fd8]")} />;
  if ([".js", ".jsx", ".mjs"].includes(ext)) return <FileCode2 className={clsx(cls, "text-[#d8c04f]")} />;
  if (ext === ".json") return <FileJson className={clsx(cls, "text-[#b0b84f]")} />;
  if (ext === ".py") return <ScanText className={clsx(cls, "text-[#6aa84f]")} />;
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp"].includes(ext)) return <Image className={clsx(cls, "text-[#c96f8a]")} />;
  if ([".md", ".txt"].includes(ext)) return <FileText className={clsx(cls, "text-muted")} />;
  if ([".html", ".css", ".scss"].includes(ext)) return <FileType className={clsx(cls, "text-accent")} />;
  return <FileText className={clsx(cls, "text-muted")} />;
}

function Row({ entry, depth }: { entry: WorkspaceFileInfo; depth: number }) {
  const { expanded, children, loading, toggleDir } = useWorkspaceStore();
  const highlight = useWorkspaceStore((s) => s.highlightPath);
  const activePath = useEditorStore((s) => s.activePath);
  const openFile = useEditorStore((s) => s.openFile);
  const isOpen = expanded[entry.path];
  const isActive = activePath === entry.path;
  const isFlash = highlight === entry.path;

  if (entry.type === "directory") {
    return (
      <div>
        <button
          className={clsx(
            "flex w-full items-center gap-1 rounded px-1 py-[3px] text-left text-[13px] hover:bg-panel2", isFlash && "fileflash",
            "text-ink/90"
          )}
          style={{ paddingLeft: depth * 14 + 6 }}
          onClick={() => void toggleDir(entry.path)}
        >
          <ChevronRight
            className={clsx("h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-150", isOpen && "rotate-90")}
          />
          {isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-accent/80" />}
          <span className="truncate">{entry.name}</span>
        </button>
        {isOpen && (
          <div>
            {loading[entry.path] && (
              <div className="flex items-center gap-1 py-1 text-xs text-muted" style={{ paddingLeft: (depth + 1) * 14 + 22 }}>
                <Loader2 className="h-3 w-3 animate-spin" /> loading…
              </div>
            )}
            {(children[entry.path] ?? []).map((child) => (
              <Row key={child.path} entry={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className={clsx(
        "flex w-full items-center gap-1.5 rounded px-1 py-[3px] text-left text-[13px] hover:bg-panel2", isFlash && "fileflash",
        isActive ? "bg-panel2 text-ink" : "text-ink/80"
      )}
      style={{ paddingLeft: depth * 14 + 22 }}
      onClick={() => void openFile(entry.path)}
      title={entry.path}
    >
      {iconFor(entry)}
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

function FileTreeInner() {
  const root = useWorkspaceStore((s) => s.root);
  const children = useWorkspaceStore((s) => s.children);
  if (!root) return null;
  const entries = children["."] ?? [];
  return (
    <div className="min-w-0">
      {entries.map((entry) => (
        <Row key={entry.path} entry={entry} depth={0} />
      ))}
      {entries.length === 0 && <div className="px-2 py-1 text-xs text-muted">Empty folder</div>}
    </div>
  );
}

export const FileTree = memo(FileTreeInner);
