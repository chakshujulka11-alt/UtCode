import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { BINARY_EXTENSIONS, IGNORED_DIRECTORIES, VECTOR_MAX_FILE_BYTES, VECTOR_MAX_FILES } from "../../shared/constants";
import { request } from "../providers/http";

export interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface VectorSearchHit {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}

export interface VectorStatusInfo {
  files: number;
  chunks: number;
  backend: string;
  lastIndexedAt: number | null;
}

export type ProgressFn = (done: number, total: number, note?: string) => void;

const LEX_DIMS = 256;
const CHUNK_LINES = 48;
const CHUNK_STEP = 40;
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".py", ".html", ".htm", ".css", ".scss", ".less",
  ".md", ".markdown", ".txt", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".rs", ".go", ".java", ".c", ".h",
  ".cpp", ".hpp", ".cs", ".rb", ".php", ".sh", ".ps1", ".sql", ".xml", ".env", ".svelte", ".vue", ".gradle"
]);

interface ChunkMeta {
  path: string;
  start: number;
  end: number;
  text: string;
}

interface IndexShape {
  backend: "lexical" | "model";
  model: string;
  dims: number;
  updatedAt: number;
  files: Record<string, { mtime: number; from: number; count: number }>;
  meta: ChunkMeta[];
  vectors: number[][];
}

function emptyIndex(): IndexShape {
  return { backend: "lexical", model: "", dims: LEX_DIMS, updatedAt: 0, files: {}, meta: [], vectors: [] };
}

export function tokenize(text: string): string[] {
  const words: string[] = [];
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/[a-z_][a-z0-9_]{1,30}/g)) {
    const parts = m[0].split(/[_$]+/).filter((p) => p.length > 1);
    words.push(...(parts.length > 0 ? parts : [m[0]]));
  }
  const camel = text.match(/[A-Z][a-z0-9]{2,}/g);
  if (camel) for (const c of camel) words.push(c.toLowerCase());
  return words;
}

function hashBucket(token: string, dims: number): number {
  let h = 5381;
  for (let i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) | 0;
  return Math.abs(h) % dims;
}

export function lexicalEmbed(text: string): number[] {
  const v = new Array<number>(LEX_DIMS).fill(0);
  const tokens = tokenize(text);
  for (const t of tokens) v[hashBucket(t, LEX_DIMS)] += 1;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

export function chunkText(relPath: string, text: string, maxChunks = 60): { start: number; end: number; text: string }[] {
  const lines = text.split("\n");
  const out: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < lines.length && out.length < maxChunks; i += CHUNK_STEP) {
    const end = Math.min(lines.length - 1, i + CHUNK_LINES - 1);
    const body = lines.slice(i, end + 1).join("\n").slice(0, 2000);
    if (body.trim().length > 0) out.push({ start: i + 1, end: end + 1, text: `${relPath}\n${body}` });
    if (end === lines.length - 1) break;
  }
  return out;
}

async function listCodeFiles(root: string, budget: { left: number }): Promise<{ abs: string; rel: string; mtime: number; size: number }[]> {
  const out: { abs: string; rel: string; mtime: number; size: number }[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (budget.left <= 0) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (budget.left <= 0) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.includes(entry.name.toLowerCase())) continue;
        await walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext) || !TEXT_EXT.has(ext)) continue;
        try {
          const stat = await fsp.stat(full);
          if (stat.size > VECTOR_MAX_FILE_BYTES) continue;
          budget.left--;
          out.push({ abs: full, rel: path.relative(root, full).split(path.sep).join("/"), mtime: stat.mtimeMs, size: stat.size });
        } catch {
          /* ignore */
        }
      }
    }
  };
  await walk(root);
  return out;
}

async function embedModel(cfg: EmbeddingConfig, texts: string[]): Promise<number[][] | null> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  try {
    const res = await request({
      method: "POST",
      url: `${base}/embeddings`,
      headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
      body: { model: cfg.model, input: texts },
      timeoutMs: 30000
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: { embedding: number[] }[] };
      if (Array.isArray(json.data) && json.data.length === texts.length) return json.data.map((d) => d.embedding);
    }
  } catch {
    /* try ollama next */
  }
  try {
    const res = await request({
      method: "POST",
      url: `${base.replace(/\/v1$/, "")}/api/embed`,
      headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
      body: { model: cfg.model, input: texts },
      timeoutMs: 30000
    });
    if (res.ok) {
      const json = (await res.json()) as { embeddings?: number[][] };
      if (Array.isArray(json.embeddings) && json.embeddings.length === texts.length) return json.embeddings;
    }
  } catch {
    /* fall back to lexical */
  }
  return null;
}

class VectorStore {
  private indexes = new Map<string, IndexShape>();
  private indexing = new Map<string, { running: boolean; done: number; total: number }>();
  private currentAbort: AbortController | null = null;

  private filePath(root: string): string {
    return path.join(root, ".utcode", "vectors.json");
  }

  status(root: string | null): VectorStatusInfo {
    if (!root) return { files: 0, chunks: 0, backend: "—", lastIndexedAt: null };
    const idx = this.load(root);
    return {
      files: Object.keys(idx.files).length,
      chunks: idx.meta.length,
      backend: idx.backend === "model" ? `model · ${idx.model}` : "built-in lexical",
      lastIndexedAt: idx.updatedAt || null
    };
  }

  isIndexing(root: string | null): boolean {
    return root ? this.indexing.get(root)?.running === true : false;
  }

  progress(root: string | null): { done: number; total: number } {
    const p = root ? this.indexing.get(root) : null;
    return { done: p?.done ?? 0, total: p?.total ?? 0 };
  }

  cancelIndexing(): void {
    this.currentAbort?.abort();
    this.currentAbort = null;
  }

  clearCache(): void {
    this.indexes.clear();
  }

  private load(root: string): IndexShape {
    let idx = this.indexes.get(root);
    if (idx) return idx;
    try {
      const file = this.filePath(root);
      if (fs.existsSync(file)) {
        idx = JSON.parse(fs.readFileSync(file, "utf-8")) as IndexShape;
        if (idx && Array.isArray(idx.meta) && Array.isArray(idx.vectors) && idx.meta.length === idx.vectors.length) {
          this.indexes.set(root, idx);
          return idx;
        }
      }
    } catch {
      /* rebuild below */
    }
    idx = emptyIndex();
    this.indexes.set(root, idx);
    return idx;
  }

  async index(root: string, cfg: EmbeddingConfig | null, onProgress?: ProgressFn, full = false): Promise<VectorStatusInfo> {
    if (this.isIndexing(root)) return this.status(root);
    const state = { running: true, done: 0, total: 0 };
    this.indexing.set(root, state);
    this.currentAbort = new AbortController();
    const signal = this.currentAbort.signal;
    try {
      const idx = full ? emptyIndex() : this.load(root);
      const budget = { left: VECTOR_MAX_FILES };
      const files = await listCodeFiles(root, budget);
      const toDo = files.filter((f) => {
        const known = idx.files[f.rel];
        return !known || known.mtime !== f.mtime;
      });
      state.total = toDo.length;
      let backend: IndexShape["backend"] = idx.backend;
      let model = idx.model;

      for (let i = 0; i < toDo.length; i++) {
        if (signal.aborted) break;
        const file = toDo[i];
        let text: string;
        try {
          text = await fsp.readFile(file.abs, "utf-8");
        } catch {
          continue;
        }
        if (text.includes("\0")) continue;
        const chunks = chunkText(file.rel, text);
        const old = idx.files[file.rel];
        if (old) {
          idx.meta.splice(old.from, old.count);
          idx.vectors.splice(old.from, old.count);
          for (const key of Object.keys(idx.files)) {
            const e = idx.files[key];
            if (e.from > old.from) e.from -= old.count;
          }
        }
        let vectors: number[][] | null = null;
        if (cfg && chunks.length > 0) {
          vectors = [];
          for (let b = 0; b < chunks.length && vectors !== null; b += 16) {
            const part = await embedModel(cfg, chunks.slice(b, b + 16).map((c) => c.text.slice(0, 1200)));
            if (!part) {
              vectors = null;
              break;
            }
            vectors.push(...part);
          }
        }
        let useLexical = vectors === null;
        if (vectors && idx.backend === "lexical" && idx.meta.length > 0) useLexical = true;
        if (useLexical) {
          vectors = chunks.map((c) => lexicalEmbed(c.text));
          if (!idx.meta.length || !cfg) {
            backend = "lexical";
            model = "";
          }
        } else if (cfg) {
          backend = "model";
          model = cfg.model;
        }
        const from = idx.meta.length;
        for (let j = 0; j < chunks.length; j++) {
          idx.meta.push({ path: file.rel, start: chunks[j].start, end: chunks[j].end, text: chunks[j].text });
          idx.vectors.push(vectors![j]);
        }
        idx.files[file.rel] = { mtime: file.mtime, from, count: chunks.length };
        idx.backend = backend;
        idx.model = model;
        idx.dims = vectors![0]?.length ?? idx.dims;
        state.done = i + 1;
        onProgress?.(state.done, state.total, file.rel);
        if (state.done % 25 === 0) await this.persist(root, idx);
      }
      idx.updatedAt = Date.now();
      await this.persist(root, idx);
      return this.status(root);
    } finally {
      state.running = false;
      this.currentAbort = null;
    }
  }

  private async persist(root: string, idx: IndexShape): Promise<void> {
    try {
      const file = this.filePath(root);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, JSON.stringify(idx), "utf-8");
    } catch {
      /* index cache is best-effort */
    }
  }

  async search(root: string, query: string, topK: number, cfg: EmbeddingConfig | null): Promise<{ hits: VectorSearchHit[]; backend: string }> {
    let idx = this.load(root);
    if (idx.meta.length === 0) {
      await this.index(root, cfg);
      idx = this.load(root);
    }
    if (idx.meta.length === 0) return { hits: [], backend: "empty" };
    let qv: number[] | null = null;
    if (idx.backend === "model" && cfg) {
      const embedded = await embedModel(cfg, [query]);
      qv = embedded?.[0] ?? null;
    }
    if (!qv) qv = lexicalEmbed(query);
    const scored: { i: number; s: number }[] = [];
    for (let i = 0; i < idx.vectors.length; i++) {
      const s = cosine(idx.vectors[i], qv);
      if (s > 0.01) scored.push({ i, s });
    }
    scored.sort((a, b) => b.s - a.s);
    const seen = new Set<string>();
    const hits: VectorSearchHit[] = [];
    for (const sc of scored) {
      const m = idx.meta[sc.i];
      const key = `${m.path}:${m.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ path: m.path, startLine: m.start, endLine: m.end, score: sc.s, snippet: m.text.replace(/^[^\n]*\n/, "").slice(0, 500) });
      if (hits.length >= Math.min(Math.max(1, topK), 20)) break;
    }
    return { hits, backend: idx.backend === "model" ? `model · ${idx.model}` : "built-in lexical" };
  }
}

export const vectorStore = new VectorStore();
