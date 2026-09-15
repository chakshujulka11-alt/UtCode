import { useEffect, useState } from "react";
import { useUiStore } from "../stores/uiStore";
import { UtcodeLogo } from "./UtcodeLogo";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { api, call } from "../stores/api";

export function TitleBar() {
  const isSidebarOpen = useUiStore((s) => s.isSidebarOpen);
  const root = useWorkspaceStore((s) => s.root);
  const [version, setVersion] = useState("");

  useEffect(() => {
    void call(api.utcode.appInfo()).then((i) => setVersion(i.version)).catch(() => undefined);
  }, []);

  const projectName = root ? root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : null;

  return (
    <div
      data-titlebar
      className="flex h-9 shrink-0 items-center gap-2 border-b border-edge bg-side pl-3 pr-0 text-[12px] text-muted select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <UtcodeLogo size={15} />
      <span className="font-semibold text-ink/90">utcode</span>
      {projectName && (
        <span className="truncate text-muted" title={root ?? ""}>
          — {projectName}
        </span>
      )}
      {isSidebarOpen && <span className="italic text-muted/70">explorer open</span>}
      {version && <span className="ml-auto mr-2 text-[11px] opacity-60">v{version}</span>}
      {/* clearance for native window-control overlay (min / max / close) */}
      <div className="w-[138px] shrink-0" />
    </div>
  );
}
