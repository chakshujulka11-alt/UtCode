import type { IpcResult } from "../../shared/types";

export const api = {
  get utcode(): UtcodeApiLike {
    return window.utcode;
  }
};

type UtcodeApiLike = Window["utcode"];

export async function call<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise;
  if (!result.success) {
    const err = new Error(result.error ?? "Unknown error");
    (err as Error & { technical?: string }).technical = result.details;
    throw err;
  }
  return result.data as T;
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) {
    const technical = (err as Error & { technical?: string }).technical;
    return technical && technical !== err.message ? `${err.message} (${technical})` : err.message;
  }
  return String(err);
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clsx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
