import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { snapshotManager, type Checkpoint } from "../src/main/fileSystem/snapshotManager";

type Msg = NonNullable<Checkpoint["messages"]>;

let root: string;
const RUN = "run-test-1";

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "utcode-snap-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function cp(callId: string, toolName: string, timestamp: number, messages?: Msg | null) {
  snapshotManager.start({ runId: RUN, callId, toolName, task: "do it", workspaceRoot: root, timestamp, messages: messages ?? null });
}

describe("snapshotManager", () => {
  it("discards checkpoints that never changed a file", () => {
    cp("a", "read_file", 1000);
    expect(snapshotManager.finish(RUN, "a")).toBe(false);
    expect(snapshotManager.count(RUN)).toBe(0);
  });

  it("tracks file changes and keeps changed checkpoints", () => {
    cp("b", "write_file", 2000);
    snapshotManager.recordFileChange(RUN, "b", "note.txt", null);
    writeFileSync(path.join(root, "note.txt"), "v1");
    expect(snapshotManager.finish(RUN, "b")).toBe(true);
    expect(snapshotManager.count(RUN)).toBe(1);
  });

  it("restores to a middle checkpoint (last write wins per file)", async () => {
    cp("c", "patch_file", 3000);
    snapshotManager.recordFileChange(RUN, "c", "note.txt", "v1");
    writeFileSync(path.join(root, "note.txt"), "v2");
    expect(snapshotManager.finish(RUN, "c")).toBe(true);
    expect(snapshotManager.count(RUN)).toBe(2);

    const out = await snapshotManager.restore(root, RUN, "c");
    expect(readFileSync(path.join(root, "note.txt"), "utf-8")).toBe("v1");
    expect(out.remainingCheckpoints).toBe(1);
    expect(out.task).toBe("do it");
    expect(out.restoredFiles.map((f) => f.path)).toEqual(["note.txt"]);
  });

  it("deletes files created after the restore point with __all__", async () => {
    const out = await snapshotManager.restore(root, RUN, "__all__");
    expect(existsSync(path.join(root, "note.txt"))).toBe(false);
    expect(out.remainingCheckpoints).toBe(0);
    expect(snapshotManager.count(RUN)).toBe(0);
  });

  it("errors cleanly when nothing to restore", async () => {
    await expect(snapshotManager.restore(root, RUN, "nope")).rejects.toThrow(/checkpoint/i);
  });

  it("preserves the messages snapshot for resume", async () => {
    writeFileSync(path.join(root, "x.txt"), "before");
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: "original task" }
    ];
    cp("d", "write_file", 4000, messages);
    snapshotManager.recordFileChange(RUN, "d", "x.txt", "before");
    writeFileSync(path.join(root, "x.txt"), "after");
    snapshotManager.finish(RUN, "d");
    const out = await snapshotManager.restore(root, RUN, "d");
    expect(out.messages).toEqual(messages);
    expect(readFileSync(path.join(root, "x.txt"), "utf-8")).toBe("before");
  });

  it("mergeChanges returns first-before/last-after per file across steps", () => {
    const MERGE = "run-merge-1";
    const start = (callId: string, ts: number) =>
      snapshotManager.start({ runId: MERGE, callId, toolName: "patch_file", task: "t", workspaceRoot: root, timestamp: ts, messages: null });
    start("m1", 10);
    snapshotManager.recordFileChange(MERGE, "m1", "f.ts", "v0", "v1");
    snapshotManager.finish(MERGE, "m1");
    start("m2", 11);
    snapshotManager.recordFileChange(MERGE, "m2", "f.ts", "v1", "v2");
    snapshotManager.finish(MERGE, "m2");
    start("m3", 12);
    snapshotManager.recordFileChange(MERGE, "m3", "g.ts", null, "made-up");
    snapshotManager.finish(MERGE, "m3");
    const merged = snapshotManager.mergeChanges(MERGE);
    const f = merged.find((m) => m.path === "f.ts");
    const g = merged.find((m) => m.path === "g.ts");
    expect(f).toMatchObject({ before: "v0", after: "v2", edits: 2 });
    expect(g).toMatchObject({ before: null, after: "made-up", edits: 1 });
  });
});
