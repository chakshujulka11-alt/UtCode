import { createReadStream, statSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const CHUNK_SIZE = 1024 * 1024; // 1 MB

export type FileChangeOperation = "create" | "modify" | "delete";

/**
 * Stream a text file in ~1MB chunks with progress — never one giant
 * readFileSync/Buffer.alloc for multi-MB logs, JSON or bundles.
 * An optional AbortSignal destroys the stream mid-flight (caller no longer cares).
 */
export async function readFileChunked(
  filepath: string,
  onChunk: (chunk: string, progress: number) => void,
  onComplete: () => void,
  onError: (error: Error) => void,
  signal?: AbortSignal
): Promise<void> {
  try {
    const stats = statSync(filepath);
    const totalSize = stats.size;
    let bytesRead = 0;

    const stream = createReadStream(filepath, {
      encoding: "utf-8",
      highWaterMark: CHUNK_SIZE
    });
    if (signal) {
      if (signal.aborted) {
        stream.destroy();
        return;
      }
      signal.addEventListener("abort", () => stream.destroy(), { once: true });
    }

    stream.on("data", (chunk) => {
      const text = String(chunk);
      bytesRead += Buffer.byteLength(text);
      const progress = totalSize === 0 ? 100 : Math.min(100, Math.round((bytesRead / totalSize) * 100));
      onChunk(text, progress);
    });
    stream.on("end", () => {
      if (!signal?.aborted) onComplete();
    });
    stream.on("close", () => {
      if (signal?.aborted) onComplete();
    });
    stream.on("error", (err) => onError(err instanceof Error ? err : new Error(String(err))));
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

/** Classify an fs.watch event into a create/modify/delete operation. */
export function classifyOperation(eventType: string, _absPath: string, existsNow: boolean): FileChangeOperation {
  if (eventType === "rename") {
    return existsNow ? "create" : "delete";
  }
  if (!existsNow) return "delete";
  return "modify";
}

export async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fsp.stat(absPath);
    return true;
  } catch {
    return false;
  }
}

export function displaySize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function joinPosix(...parts: string[]): string {
  return path.join(...parts).split(path.sep).join("/");
}
