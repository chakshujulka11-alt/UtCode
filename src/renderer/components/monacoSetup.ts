import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

let configured = false;

function stubWorker(): Worker {
  const source = "self.onmessage = () => { /* utcode: monaco worker unavailable (language services limited) */ };";
  return new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
}

function tryWorker(factory: () => Worker): Worker {
  try {
    return factory();
  } catch (err) {
    console.warn("utcode: failed to start monaco worker, using fallback", err);
    try {
      return new editorWorker();
    } catch {
      return stubWorker();
    }
  }
}

export function configureMonaco(): typeof monaco {
  if (!configured) {
    configured = true;
    window.MonacoEnvironment = {
      getWorker(_workerId: string, label: string): Worker {
        switch (label) {
          case "typescript":
          case "javascript":
            return tryWorker(() => new tsWorker());
          case "json":
            return tryWorker(() => new jsonWorker());
          case "css":
          case "scss":
          case "less":
            return tryWorker(() => new cssWorker());
          case "html":
          case "handlebars":
          case "razor":
            return tryWorker(() => new htmlWorker());
          default:
            return tryWorker(() => new editorWorker());
        }
      }
    };
    monaco.editor.defineTheme("utcode-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#232323",
        "editor.lineHighlightBackground": "#2f2f3180",
        "editorLineNumber.foreground": "#6a6a6a",
        "editor.selectionBackground": "#d977573d",
        "editorIndentGuide.background": "#3a3a3a",
        "diffEditor.insertedTextBackground": "#3f7d4a2f",
        "diffEditor.removedTextBackground": "#a3452f30"
      }
    });
    monaco.editor.defineTheme("utcode-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: { "editor.background": "#faf7f2" }
    });
  }
  return monaco;
}

export { monaco };
