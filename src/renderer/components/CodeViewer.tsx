import { useEffect, useRef } from "react";
import { FileCode2 } from "lucide-react";
import { configureMonaco, monaco } from "./monacoSetup";
import { themeIsDark } from "../theme";
import { useEditorStore } from "../stores/editorStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";

configureMonaco();

const MODEL_URI_CACHE = new Map<string, monaco.Uri>();

function modelUri(path: string): monaco.Uri {
  let uri = MODEL_URI_CACHE.get(path);
  if (!uri) {
    uri = monaco.Uri.parse(`file:///utcode/${path.split("/").map(encodeURIComponent).join("/")}`);
    MODEL_URI_CACHE.set(path, uri);
  }
  return uri;
}

export function CodeViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const ignoreChange = useRef(false);
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const updateContent = useEditorStore((s) => s.updateContent);
  const saveActive = useEditorStore((s) => s.saveActive);
  const settings = useSettingsStore((s) => s.settings);
  const setPanelTab = useUiStore((s) => s.setPanelTab);
  const activeTab = tabs.find((t) => t.path === activePath);

  useEffect(() => {
    if (!containerRef.current) return;
    const editor = monaco.editor.create(containerRef.current, {
      value: "",
      language: "plaintext",
      theme: "utcode-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "'Cascadia Code', Consolas, monospace",
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      renderLineHighlight: "line",
      tabSize: 2,
      wordWrap: "off",
      padding: { top: 8 }
    });
    editor.onDidChangeModelContent(() => {
      if (ignoreChange.current) return;
      const path = useEditorStore.getState().activePath;
      if (!path) return;
      updateContent(path, editor.getValue());
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveActive();
    });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const dark = themeIsDark(settings?.ui);
    monaco.editor.setTheme(dark ? "utcode-dark" : "utcode-light");
  }, [settings?.ui]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!activeTab || activeTab.binary) {
      editor.setModel(null);
      return;
    }
    const uri = modelUri(activeTab.path);
    let model = monaco.editor.getModel(uri);
    if (!model) {
      model = monaco.editor.createModel(activeTab.content, activeTab.language, uri);
    } else if (model.getValue() !== activeTab.content && !model.isDisposed()) {
      ignoreChange.current = true;
      model.setValue(activeTab.content);
      ignoreChange.current = false;
    }
    if (editor.getModel() !== model) editor.setModel(model);
    if (activeTab.conflict) {
      useUiStore.getState().toastMessage(`${activeTab.path}: agent also changed this file — resolve in Diff tab`, "error");
      setPanelTab("diff");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, tabs]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {!activePath && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-canvas text-muted">
          <FileCode2 className="h-16 w-16 text-edge" strokeWidth={1.2} />
          <p className="text-sm font-medium text-ink/70">No file open</p>
          <p className="max-w-xs text-center text-xs leading-relaxed">Click a file in the sidebar or ask the agent to create one.</p>
        </div>
      )}
      {activeTab?.loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg text-sm text-muted">Loading {activePath}…</div>
      )}
      {activeTab?.binary && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg p-4 text-sm text-muted">{activePath} is a binary file and cannot be edited here.</div>
      )}
      {activeTab?.streamProgress != null && (
        <div className="absolute bottom-2 left-1/2 flex w-64 -translate-x-1/2 items-center gap-2 rounded-md border border-accent/40 bg-panel px-3 py-1.5 text-xs text-ink shadow-lg">
          <span className="shrink-0 text-muted">streaming…</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-panel2">
            <div className="h-full rounded-full bg-accent transition-all duration-200" style={{ width: `${activeTab.streamProgress}%` }} />
          </div>
          <span className="w-8 text-right font-mono">{activeTab.streamProgress}%</span>
        </div>
      )}
      {activeTab?.truncated && !activeTab.loading && activeTab.streamProgress == null && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md border border-amber-500/50 bg-amber-950/70 px-3 py-1 text-xs text-amber-300">
          Very large file — showing only the first part (up to 8 MB) to keep the editor fast.
        </div>
      )}
    </div>
  );
}
