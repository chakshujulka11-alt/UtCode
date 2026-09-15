import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyOperation, readFileChunked, displaySize } from "../src/main/fileSystem/fileIO";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "utcode-fileio-"));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("readFileChunked", () => {
  it("reassembles a multi-MB file with progress reaching 100", async () => {
    const file = path.join(dir, "big.txt");
    const line = "abcdefghij".repeat(100); // 1000 chars
    writeFileSync(file, `${line}\n`.repeat(2500)); // ~2.5 MB

    let bytes = 0;
    let last = 0;
    let done = false;
    await new Promise<void>((resolve, reject) => {
      void readFileChunked(
        file,
        (_chunk, progress) => {
          bytes += _chunk.length;
          last = progress;
        },
        () => {
          done = true;
          resolve();
        },
        reject
      );
    });
    expect(done).toBe(true);
    expect(bytes).toBeGreaterThanOrEqual(2500 * 1001);
    expect(last).toBe(100);
  });

  it("reports an error for a missing file instead of throwing", async () => {
    const err = await new Promise<string>((resolve) => {
      void readFileChunked(path.join(dir, "nope.txt"), () => undefined, () => resolve(""), (e) => resolve(e.message));
    });
    expect(err).toMatch(/ENOENT/);
  });

  it("stops streaming when the abort signal fires", async () => {
    const file = path.join(dir, "abort.txt");
    writeFileSync(file, "x".repeat(6 * 1024 * 1024));
    const controller = new AbortController();
    let chunks = 0;
    await new Promise<void>((resolve) => {
      void readFileChunked(
        file,
        () => {
          chunks++;
          if (chunks >= 2) controller.abort();
        },
        () => resolve(),
        () => resolve(),
        controller.signal
      );
    });
    expect(chunks).toBeLessThanOrEqual(6);
  });
});

describe("classifyOperation", () => {
  it("rename+exists = create, rename+missing = delete, change = modify", () => {
    expect(classifyOperation("rename", "/x/y", true)).toBe("create");
    expect(classifyOperation("rename", "/x/y", false)).toBe("delete");
    expect(classifyOperation("change", "/x/y", true)).toBe("modify");
    expect(classifyOperation("change", "/x/y", false)).toBe("delete");
  });
});

describe("displaySize", () => {
  it("formats bytes readably", () => {
    expect(displaySize(512)).toBe("512 B");
    expect(displaySize(2048)).toBe("2.0 KB");
    expect(displaySize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
