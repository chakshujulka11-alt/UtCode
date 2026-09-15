import { createElement, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEditorStore } from "../stores/editorStore";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { usePreviewStore } from "../stores/previewStore";
import { PreviewConsole } from "./PreviewConsole";
import { PREVIEW_PARTITION } from "../../shared/constants";

function toPreviewUrl(root: string, rel: string): string {
  void root; // host is always the current workspace; resolved + confined in the main process
  const clean = rel.replace(/^[\\/]+/, "").replace(/\\/g, "/");
  return `utcode-preview://workspace/${clean
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export function PreviewView() {
  const root = useWorkspaceStore((s) => s.root);
  const activePath = useEditorStore((s) => s.activePath);
  const nonce = useUiStore((s) => s.previewNonce);
  const lowMemory = useSettingsStore((s) => s.settings?.ui.lowMemoryMode === true);
  const crashed = usePreviewStore((s) => s.crashed);
  const setCrashed = usePreviewStore((s) => s.setCrashed);
  const lines = usePreviewStore((s) => s.lines);
  const [file, setFile] = useState("");
  const [bust, setBust] = useState(0);
  const firstNonce = useRef(nonce);
  const reloadTimer = useRef<number | null>(null);

  const candidate = file.trim() || (activePath && /\.html?$/i.test(activePath) ? activePath : "index.html");
  const url = root ? toPreviewUrl(root, candidate) : null;

  // auto-reload 500ms after any save/change touching the previewed workspace
  useEffect(() => {
    if (nonce === firstNonce.current) return;
    firstNonce.current = nonce;
    if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      setBust((b) => b + 1);
      setCrashed(null);
    }, 500);
    return () => {
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    };
  }, [nonce, setCrashed]);

  if (!root) {
    return <div className="p-4 text-sm text-muted">Open a workspace to preview web files.</div>;
  }

  const recentErrors = lines
    .filter((l) => l.level === "error")
    .slice(-5);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-1.5">
        <input
          className="input !w-56 !py-1 font-mono text-xs"
          value={file}
          placeholder={candidate}
          onChange={(e) => setFile(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setBust((b) => b + 1);
          }}
          title="Workspace-relative HTML file to preview"
        />
        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { setBust((b) => b + 1); setCrashed(null); }} title="Reload preview">
          <RefreshCw className="h-3.5 w-3.5" /> Reload Preview
        </button>
        <span className="ml-auto max-w-[280px] truncate font-mono text-[10px] text-muted" title="Preview runs entirely inside utcode — this URL is never handed to Windows">
          {url ?? ""}
        </span>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        {crashed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-canvas/95 p-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-400">
              <AlertTriangle className="h-6 w-6" />
            </span>
            <div className="text-sm font-semibold text-ink">Preview crashed ({crashed})</div>
            <p className="max-w-sm text-xs text-muted">
              The preview runs in its own isolated process — utcode and your agent tasks were unaffected.
            </p>
            {recentErrors.length > 0 && (
              <div className="max-h-28 w-full max-w-md overflow-y-auto rounded-md border border-edge bg-[#0f0f0f] p-2 text-left font-mono text-[10px] text-red-300">
                {recentErrors.map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap break-words">{l.message}</div>
                ))}
              </div>
            )}
            <button className="btn-primary" onClick={() => { setCrashed(null); setBust((b) => b + 1); }}>
              <RefreshCw className="h-4 w-4" /> Reload
            </button>
          </div>
        )}
        {createElement("webview", {
          key: `${url}|${bust}`,
          src: url ?? "about:blank",
          partition: PREVIEW_PARTITION,
          referrerpolicy: "no-referrer-when-downgrade",
          webpreferences: "contextIsolation=yes,nodeIntegration=no,sandbox=yes,enableWebSQL=no,images=yes,javascript=yes",
          style: { width: "100%", height: "100%", display: "inline-flex", border: 0 },
          className: "h-full w-full border-0"
        })}
      </div>
      {lowMemory && (
        <div className="border-t border-edge bg-amber-950/20 px-3 py-1 text-[10px] text-amber-400/90">
          Low Memory Mode is on — previews of WebGL/3D content may be slow.
        </div>
      )}
      <PreviewConsole />
      <div className="border-t border-edge px-3 py-1 text-[10px] text-muted">
        Isolated webview process · WebGL + real CSS/JS · relative fetch(), .wasm, .glb, images load via utcode-preview:// · auto-reloads on save
      </div>
    </div>
  );
}
