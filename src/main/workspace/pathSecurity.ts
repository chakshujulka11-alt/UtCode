import path from "node:path";

export class PathSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSecurityError";
  }
}

export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function isInside(root: string, target: string): boolean {
  const r = path.resolve(root);
  const t = path.resolve(target);
  const rn = normalizeSlashes(r);
  const tn = normalizeSlashes(t);
  return tn === rn || tn.startsWith(rn + "/");
}

export function resolveWorkspacePath(root: string, input: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new PathSecurityError("Path must be a non-empty string.");
  }
  if (input.includes("\0")) {
    throw new PathSecurityError("Path contains invalid characters.");
  }
  const candidate = path.isAbsolute(input) ? path.normalize(input) : path.resolve(root, input);
  if (!isInside(root, candidate)) {
    throw new PathSecurityError(
      `Access denied: "${input}" resolves outside the opened workspace. Only paths inside the workspace are allowed.`
    );
  }
  return candidate;
}

export function toWorkspaceRelative(root: string, absolute: string): string {
  const rel = path.relative(root, absolute);
  return rel.split(path.sep).join("/");
}
