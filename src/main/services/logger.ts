import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { LOG_FILE } from "../../shared/constants";

let logPath: string | null = null;
let buffer: string[] = [];

const SECRET_PATTERN = /(api[_-]?key|authorization|bearer|token|password|secret)/i;

function redact(input: string): string {
  let out = input.replace(/"(api[_-]?key|authorization|token|password|secret)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"');
  out = out.replace(/(sk|key|token|api[_-]?key)[-_A-Za-z0-9]{12,}/gi, "[redacted]");
  return out;
}

function ensurePath(): string | null {
  try {
    if (!logPath) {
      logPath = path.join(app.getPath("userData"), LOG_FILE);
    }
    return logPath;
  } catch {
    return null;
  }
}

function write(level: string, scope: string, message: string): void {
  const line = `${new Date().toISOString()} [${level}] [${scope}] ${redact(message)}`;
  // eslint-disable-next-line no-console
  console.log(line);
  const p = ensurePath();
  if (!p) {
    buffer.push(line);
    return;
  }
  if (buffer.length) {
    buffer.push(line);
    const flush = buffer;
    buffer = [];
    try {
      fs.appendFileSync(p, flush.join("\n") + "\n", "utf-8");
      return;
    } catch {
      /* ignore */
    }
  }
  try {
    fs.appendFileSync(p, line + "\n", "utf-8");
  } catch {
    /* ignore */
  }
}

export const logger = {
  info: (scope: string, message: string) => write("INFO", scope, message),
  warn: (scope: string, message: string) => write("WARN", scope, message),
  error: (scope: string, message: string) => write("ERROR", scope, message),
  debug: (scope: string, message: string) => {
    if (SECRET_PATTERN.test(scope)) return;
    write("DEBUG", scope, message);
  }
};

export function errorToMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

export function friendlyError(err: unknown): { message: string; technical: string } {
  const technical = errorToMessage(err);
  const t = technical.toLowerCase();
  let message = technical;
  if (t.includes("econnrefused") || t.includes("enotfound") || t.includes("fetch failed")) {
    message = "Could not connect to the configured AI provider. Check the endpoint and make sure the service is running.";
  } else if (t.includes("etimedout") || t.includes("timeout") || t.includes("timed out")) {
    message = "The request timed out. The provider may be busy or unreachable.";
  } else if (t.includes("401") || t.includes("unauthorized") || t.includes("invalid api key")) {
    message = "Authentication failed. Check the API key configured for this provider.";
  } else if (t.includes("403")) {
    message = "Access denied by the provider. Check your account permissions or quota.";
  } else if (t.includes("429") || t.includes("rate limit")) {
    message = "The provider is rate limiting requests. Wait a moment and try again.";
  } else if (t.includes("enoent") && t.includes("spawn")) {
    message = "The command executable was not found. Check that it is installed and on PATH.";
  } else if (t.includes("eacces") || t.includes("eperm")) {
    message = "Permission denied for this operation.";
  } else if (t.includes("enostore") || t.includes("enospc")) {
    message = "Not enough disk space to complete the operation.";
  }
  return { message, technical };
}
