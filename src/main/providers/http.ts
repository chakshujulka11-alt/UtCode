import { ProviderError } from "./providerTypes";

export interface HttpJsonOptions {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function httpJson<T>(opts: HttpJsonOptions): Promise<T> {
  const res = await request(opts);
  const text = await res.text();
  let json: unknown;
  try {
    json = text.length ? JSON.parse(text) : {};
  } catch {
    throw new ProviderError(`Provider returned a non-JSON response (HTTP ${res.status}).`, res.status);
  }
  if (!res.ok) throw providerHttpError(res.status, json);
  return json as T;
}

export async function request(opts: HttpJsonOptions): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Request timed out waiting for the provider to respond.")), opts.timeoutMs ?? 120000);
  const onAbort = (): void => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener("abort", onAbort);
  if (opts.signal?.aborted) controller.abort(opts.signal.reason);
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: opts.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(opts.headers ?? {})
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", onAbort);
    if (controller.signal.aborted) throw err;
    throw new ProviderError(`Network error contacting ${safeHost(opts.url)}: ${err instanceof Error ? err.message : String(err)}`);
  }
  clearTimeout(timeout);
  return res;
}

export function providerHttpError(status: number, json: unknown): ProviderError {
  let detail = "";
  try {
    const j = json as Record<string, unknown>;
    const errField = (j.error ?? j.message ?? j.detail) as Record<string, unknown> | string | undefined;
    if (typeof errField === "string") detail = errField;
    else if (errField && typeof errField === "object") detail = String(errField.message ?? JSON.stringify(errField));
  } catch {
    detail = "";
  }
  const statusText: Record<number, string> = {
    401: "Invalid or missing API key.",
    403: "Access forbidden by the provider.",
    404: "Model or endpoint not found. Check the model name and base URL.",
    429: "Rate limited by the provider."
  };
  return new ProviderError(
    `Provider request failed (HTTP ${status}). ${statusText[status] ?? ""}${detail ? ` ${detail.slice(0, 400)}` : ""}`.trim(),
    status
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "provider";
  }
}

export const SSE_STOP = "stop" as const;
export type SseSignal = void | typeof SSE_STOP;

export async function readSseStream(
  res: Response,
  onData: (payload: string) => SseSignal,
  signal?: AbortSignal,
  idleTimeoutMs = 180000
): Promise<void> {
  if (!res.body) throw new ProviderError("Provider returned an empty stream.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let idleTimer: NodeJS.Timeout | undefined;
  const clearIdle = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };
  const armIdle = (): void => {
    clearIdle();
    idleTimer = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
    }, idleTimeoutMs);
    idleTimer.unref?.();
  };
  const stopAll = async (): Promise<void> => {
    clearIdle();
    await reader.cancel().catch(() => undefined);
  };
  try {
    while (true) {
      if (signal?.aborted) {
        await stopAll();
        throw signal.reason instanceof Error ? signal.reason : new Error("Cancelled");
      }
      armIdle();
      let done = false;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch {
        done = true;
      }
      clearIdle();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            if (payload.length > 0 && onData(payload) === SSE_STOP) {
              await stopAll();
              return;
            }
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith("data:")) {
      const payload = tail.slice(5).trim();
      if (payload.length > 0) onData(payload);
    }
  } finally {
    clearIdle();
    try {
      reader.releaseLock();
    } catch {
      /* already released by cancel */
    }
  }
}

export async function readNdjsonStream(
  res: Response,
  onData: (obj: Record<string, unknown>) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!res.body) throw new ProviderError("Provider returned an empty stream.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        throw signal.reason instanceof Error ? signal.reason : new Error("Cancelled");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length > 0) {
          try {
            onData(JSON.parse(line) as Record<string, unknown>);
          } catch {
            /* skip malformed line */
          }
        }
        nl = buffer.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
