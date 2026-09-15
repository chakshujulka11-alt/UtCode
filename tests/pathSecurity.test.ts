import path from "node:path";
import { describe, expect, it } from "vitest";
import { isInside, PathSecurityError, resolveWorkspacePath } from "../src/main/workspace/pathSecurity";

const ROOT = process.platform === "win32" ? "C:\\work\\proj" : "/home/user/proj";

describe("resolveWorkspacePath", () => {
  it("resolves relative paths inside the workspace", () => {
    const abs = resolveWorkspacePath(ROOT, "src/main.ts");
    expect(abs).toBe(path.resolve(ROOT, "src/main.ts"));
  });

  it("rejects parent traversal escapes", () => {
    expect(() => resolveWorkspacePath(ROOT, "../../secret.txt")).toThrow(PathSecurityError);
    expect(() => resolveWorkspacePath(ROOT, "src/../../../secret.txt")).toThrow(PathSecurityError);
  });

  it("rejects absolute paths outside the workspace", () => {
    expect(() => resolveWorkspacePath(ROOT, process.platform === "win32" ? "D:\\other\\file.txt" : "/etc/passwd")).toThrow(PathSecurityError);
  });

  it("allows absolute paths inside the workspace", () => {
    const inside = path.join(ROOT, "README.md");
    expect(resolveWorkspacePath(ROOT, inside)).toBe(inside);
  });

  it("rejects empty and null-byte paths", () => {
    expect(() => resolveWorkspacePath(ROOT, "")).toThrow(PathSecurityError);
    expect(() => resolveWorkspacePath(ROOT, "src\0\file")).toThrow(PathSecurityError);
  });

  it("does not match sibling directories with shared prefix", () => {
    expect(isInside(ROOT, ROOT + "x")).toBe(false);
  });
});
