import fs from "node:fs/promises";
import path from "node:path";
import { BINARY_EXTENSIONS, IGNORED_DIRECTORIES } from "../../shared/constants";
import type { DependencyReport, ImportedDependency } from "../../shared/types";

const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".d.ts"];
const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs"];
const TS_LIKE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const PY = ".py";

export interface ParsedImport {
  specifier: string;
  kind: "static" | "dynamic" | "require" | "python";
  pythonLevel?: number;
}

const JS_PATTERNS: RegExp[] = [
  /(?:^|\n)\s*import\s+(?:type\s+)?(?:[\w*{}\n\r\t, $]+\s+from\s+)?["']([^"']+)["']/g,
  /(?:^|\n)\s*export\s+(?:type\s+)?(?:[\w*{}\n\r\t, $]+\s+from\s+)["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
];

const PY_FROM_RE = /(?:^|\n)\s*from\s+((?:\.+)?[\w.]+)\s+import\s+([^\n#;]+)/g;
const PY_IMPORT_RE = /(?:^|\n)\s*import\s+([^\n#;]+)/g;

const EXPORT_PATTERNS: RegExp[] = [
  /export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
  /export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  /export\s*\{([^}]*)\}/g
];

export function parseImports(source: string, ext: string): ParsedImport[] {
  const out: ParsedImport[] = [];
  const seen = new Set<string>();
  const add = (specifier: string, kind: ParsedImport["kind"], level?: number): void => {
    if (!specifier) return;
    const key = `${kind}:${specifier}:${level ?? 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ specifier, kind, pythonLevel: level });
  };
  if (ext === PY) {
    PY_FROM_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PY_FROM_RE.exec(source)) !== null) {
      const raw = m[1];
      const names = m[2];
      if (raw.startsWith(".")) {
        const dots = /^\.+/.exec(raw)![0].length;
        add(raw.replace(/^\.+/, ""), "python", dots);
      } else {
        add(raw, "python");
      }
      const parenClose = names.includes(")") ? names.indexOf(")") : -1;
      const nameList = (parenClose >= 0 ? names.slice(0, parenClose) : names).split(",");
      for (const n of nameList) {
        const clean = n.trim().split(/\s+as\s+/)[0].trim();
        if (clean && clean !== "*" && !raw.startsWith(".")) add(`${raw}.${clean}`, "python");
      }
    }
    PY_IMPORT_RE.lastIndex = 0;
    while ((m = PY_IMPORT_RE.exec(source)) !== null) {
      const names = m[1].split(/[;#]/)[0].split(",");
      for (const n of names) {
        const clean = n.trim().split(/\s+as\s+/)[0].trim();
        if (/^[\w.]+$/.test(clean)) add(clean, "python");
      }
    }
    return out;
  }
  for (const re of JS_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const spec = m[1];
      if (!spec) continue;
      const kind: ParsedImport["kind"] = re.source.includes("require")
        ? "require"
        : re.source.includes("import\\\\s*\\\\(")
          ? "dynamic"
          : "static";
      add(spec, kind);
    }
  }
  return out;
}

export function extractExports(source: string, ext: string): string[] {
  const names = new Set<string>();
  if (ext === PY) {
    const fn = /(?:^|\n)\s*def\s+([A-Za-z_]\w*)/g;
    const cls = /(?:^|\n)\s*class\s+([A-Za-z_]\w*)/g;
    const top = /(?:^|\n)([A-Za-z_]\w*)\s*=/g;
    for (const re of [fn, cls, top]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        if (!m[1].startsWith("_")) names.add(m[1]);
      }
    }
    const dunder = /__all__\s*=\s*\[([^\]]*)\]/g.exec(source);
    if (dunder) {
      for (const item of dunder[1].split(",")) {
        const clean = item.trim().replace(/^["']|["']$/g, "");
        if (clean) names.add(clean);
      }
    }
    return [...names].slice(0, 60);
  }
  for (const re of EXPORT_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const raw = m[1];
      if (re.source.includes("\\{")) {
        for (const part of raw.split(",")) {
          const name = part.trim().split(/\s+as\s+/).pop()?.trim();
          if (name && name !== "default") names.add(name);
        }
      } else if (raw) {
        names.add(raw);
      }
    }
  }
  return [...names].slice(0, 60);
}

async function fileExists(p: string): Promise<string | null> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile() ? p : null;
  } catch {
    return null;
  }
}

export async function resolveJsSpecifier(
  workspaceRoot: string,
  fromFile: string,
  specifier: string
): Promise<string | null> {
  if (specifier.startsWith(".")) {
    const base = path.resolve(path.dirname(fromFile), specifier);
    for (const ext of RESOLVE_EXTENSIONS) {
      const hit = await fileExists(base + ext);
      if (hit) return hit;
    }
    for (const idx of INDEX_FILES) {
      const hit = await fileExists(path.join(base, idx));
      if (hit) return hit;
    }
    return null;
  }
  if (TS_LIKE.has(path.extname(fromFile)) && !specifier.startsWith("@")) {
    const pkgDir = path.join(workspaceRoot, "node_modules", specifier.split("/")[0]);
    try {
      await fs.stat(pkgDir);
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function resolvePythonSpecifier(
  workspaceRoot: string,
  fromFile: string,
  specifier: string,
  level: number | undefined
): Promise<string | null> {
  const asModule = (p: string): string => p.replace(/\./g, path.sep);
  if (level && level > 0) {
    let dir = path.dirname(fromFile);
    for (let i = 1; i < level; i++) dir = path.dirname(dir);
    const parts = specifier ? specifier.split(".") : [];
    const candidates = [
      path.join(dir, ...parts) + ".py",
      path.join(dir, ...parts, "__init__.py"),
      ...(parts.length === 0 ? [] : [path.join(dir, asModule(specifier) + ".py")])
    ];
    for (const c of candidates) {
      const hit = await fileExists(c);
      if (hit) return hit;
    }
    return null;
  }
  const rel = asModule(specifier);
  const candidates = [path.join(workspaceRoot, rel + ".py"), path.join(workspaceRoot, rel, "__init__.py")];
  const srcCandidates = [
    path.join(workspaceRoot, "src", rel + ".py"),
    path.join(workspaceRoot, "src", rel, "__init__.py")
  ];
  for (const c of [...candidates, ...srcCandidates]) {
    const hit = await fileExists(c);
    if (hit) return hit;
  }
  return null;
}

export async function analyzeFile(workspaceRoot: string, absFile: string): Promise<ImportedDependency[]> {
  const ext = path.extname(absFile).toLowerCase();
  if (!TS_LIKE.has(ext) && ext !== PY && ext !== ".json") return [];
  let source: string;
  try {
    source = await fs.readFile(absFile, "utf-8");
  } catch {
    return [];
  }
  const imports = parseImports(source, ext);
  const results: ImportedDependency[] = [];
  for (const imp of imports) {
    let resolved: string | null = null;
    try {
      if (ext === PY) {
        resolved = await resolvePythonSpecifier(workspaceRoot, absFile, imp.specifier, imp.pythonLevel);
      } else {
        resolved = await resolveJsSpecifier(workspaceRoot, absFile, imp.specifier);
      }
    } catch {
      resolved = null;
    }
    let exports: string[] = [];
    if (resolved) {
      exports = await getExportsOf(resolved);
    }
    results.push({
      specifier: imp.specifier,
      resolvedPath: resolved ? toRel(workspaceRoot, resolved) : null,
      exports
    });
  }
  return results;
}

const exportCache = new Map<string, { mtime: number; exports: string[] }>();

export async function getExportsOf(absFile: string): Promise<string[]> {
  const ext = path.extname(absFile).toLowerCase();
  if (!TS_LIKE.has(ext) && ext !== PY) return [];
  try {
    const stat = await fs.stat(absFile);
    const cached = exportCache.get(absFile);
    if (cached && cached.mtime === stat.mtimeMs) return cached.exports;
    const source = await fs.readFile(absFile, "utf-8");
    const exports = extractExports(source, ext);
    exportCache.set(absFile, { mtime: stat.mtimeMs, exports });
    return exports;
  } catch {
    return [];
  }
}

function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.includes(entry.name.toLowerCase())) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        if (BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        yield full;
      }
    }
  }
}

export async function findImportersOf(workspaceRoot: string, absTarget: string, limit = 20): Promise<string[]> {
  const importers: string[] = [];
  for await (const file of walkFiles(workspaceRoot)) {
    if (importers.length >= limit) break;
    if (file === absTarget) continue;
    const ext = path.extname(file).toLowerCase();
    if (!TS_LIKE.has(ext) && ext !== PY) continue;
    let source: string;
    try {
      source = await fs.readFile(file, "utf-8");
    } catch {
      continue;
    }
    const imports = parseImports(source, ext);
    for (const imp of imports) {
      let resolved: string | null = null;
      try {
        resolved =
          ext === PY
            ? await resolvePythonSpecifier(workspaceRoot, file, imp.specifier, imp.pythonLevel)
            : await resolveJsSpecifier(workspaceRoot, file, imp.specifier);
      } catch {
        resolved = null;
      }
      if (resolved === absTarget) {
        importers.push(toRel(workspaceRoot, file));
        break;
      }
    }
  }
  return importers;
}

export interface GraphOptions {
  maxDepth?: number;
  includeExports?: boolean;
}

export async function scanImports(
  workspaceRoot: string,
  absFile: string,
  opts?: GraphOptions
): Promise<DependencyReport> {
  const maxDepth = Math.min(opts?.maxDepth ?? 1, 3);
  const direct = await analyzeFile(workspaceRoot, absFile);
  const imports = direct.map((d) => ({ ...d }));
  void maxDepth;
  const importedBy = await findImportersOf(workspaceRoot, absFile);
  const exports = await getExportsOf(absFile);
  return {
    file: toRel(workspaceRoot, absFile),
    imports,
    importedBy,
    exports
  };
}

export async function buildDependencyGraph(
  workspaceRoot: string,
  absFile: string,
  maxDepth = 2
): Promise<Record<string, string[]>> {
  const graph: Record<string, string[]> = {};
  const visited = new Set<string>();
  const queue: { file: string; depth: number }[] = [{ file: absFile, depth: 0 }];
  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;
    if (visited.has(file) || depth > maxDepth) continue;
    visited.add(file);
    const rel = toRel(workspaceRoot, file);
    const deps = await analyzeFile(workspaceRoot, file);
    const resolvedLocal: string[] = [];
    for (const d of deps) {
      if (d.resolvedPath) {
        const abs = path.resolve(workspaceRoot, d.resolvedPath);
        resolvedLocal.push(d.resolvedPath);
        if (!visited.has(abs)) queue.push({ file: abs, depth: depth + 1 });
      }
    }
    graph[rel] = resolvedLocal;
    if (Object.keys(graph).length > 200) break;
  }
  return graph;
}
