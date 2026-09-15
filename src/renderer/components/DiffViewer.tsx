import { useEffect, useRef } from "react";
import { Diff, RotateCcw } from "lucide-react";
import { configureMonaco, monaco } from "./monacoSetup";
import { useEditorStore } from "../stores/editorStore";

configureMonaco();

export function DiffViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const diff = useEditorStore((s) => s.diff);
  const revertDiff = useEditorStore((s) => s.revertDiff);

  useEffect(() => {
    if (!containerRef.current) return;
    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      readOnly: true,
      renderSideBySide: true,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "'Cascadia Code', Consolas, monospace"
    });
    diffRef.current = editor;
    return () => {
      editor.dispose();
      diffRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = diffRef.current;
    if (!editor) return;
    if (!diff) {
      editor.setModel(null);
      return;
    }
    const original = monaco.editor.createModel(diff.before, undefined, monaco.Uri.parse("inmemory://utcode/diff-before"));
    const modified = monaco.editor.createModel(diff.after, undefined, monaco.Uri.parse("inmemory://utcode/diff-after"));
    editor.setModel({ original, modified });
    return () => {
      original.dispose();
      modified.dispose();
    };
  }, [diff]);

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
        {diff ? (
          <>
            <div className="min-w-0">
              <span className="truncate font-mono text-xs text-ink">{diff.path}</span>
              <span className="ml-2 rounded bg-panel2 px-1.5 py-0.5 text-[11px] text-muted">{diff.summary}</span>
            </div>
            <button className="btn-ghost !px-2 !py-1 text-xs" title="Revert file to the 'before' content" onClick={() => void revertDiff()}>
              <RotateCcw className="h-3.5 w-3.5" /> Revert
            </button>
          </>
        ) : (
          <span className="text-xs text-muted">Changes the agent makes will appear here for review.</span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />
        {!diff && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-canvas text-muted">
            <Diff className="h-16 w-16 text-edge" strokeWidth={1.2} />
            <p className="text-sm font-medium text-ink/70">No changes to review</p>
            <p className="max-w-xs text-center text-xs leading-relaxed">When the agent edits a file, the before/after diff appears here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
