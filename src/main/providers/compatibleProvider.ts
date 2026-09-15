import { request, providerHttpError, readSseStream, SSE_STOP, type SseSignal } from "./http";
import {
  buildSystemPromptText,
  nonSystemMessages,
  ProviderError,
  type AiProvider,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ProviderRuntimeConfig,
  type ToolCall,
  type UnifiedMessage
} from "./providerTypes";
import type { ProviderTestResult } from "../../shared/types";

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function resolveBaseUrl(config: ProviderRuntimeConfig, fallback?: string): string {
  const raw = config.baseUrl?.trim() || fallback || "";
  if (!raw) throw new ProviderError("Base URL is required for this provider type.");
  return raw.replace(/\/+$/, "");
}

interface OpenAiToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiStreamChunk {
  choices?: {
    delta?: { content?: string | null; tool_calls?: OpenAiToolCallDelta[] };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: unknown;
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly type: "openai" | "openai-compatible";
  private readonly defaultBaseUrl: string | undefined;

  constructor(type: "openai" | "openai-compatible", defaultBaseUrl?: string) {
    this.type = type;
    this.defaultBaseUrl = defaultBaseUrl;
  }

  protected messagesToWire(messages: UnifiedMessage[]): unknown[] {
    const out: Record<string, unknown>[] = [];
    const system = buildSystemPromptText(messages);
    if (system) out.push({ role: "system", content: system });
    for (const m of nonSystemMessages(messages)) {
      if (m.role === "user") {
        out.push({ role: "user", content: m.content });
      } else if (m.role === "assistant") {
        if (m.toolCalls && m.toolCalls.length > 0) {
          out.push({
            role: "assistant",
            content: m.content && m.content.length > 0 ? m.content : null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) }
            }))
          });
        } else {
          out.push({ role: "assistant", content: m.content });
        }
      } else if (m.role === "tool") {
        out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
      }
    }
    return out;
  }

  protected toolsToWire(tools: ChatCompletionRequest["tools"]): unknown[] | undefined {
    if (!tools || tools.length === 0) return undefined;
    return tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }));
  }

  protected headers(config: ProviderRuntimeConfig): Record<string, string> {
    const h: Record<string, string> = {};
    if (config.apiKey) h.authorization = `Bearer ${config.apiKey}`;
    return h;
  }

  async complete(config: ProviderRuntimeConfig, req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const base = resolveBaseUrl(config, this.defaultBaseUrl);
    const body: Record<string, unknown> = {
      model: req.model || config.model,
      messages: this.messagesToWire(req.messages),
      stream: true,
      temperature: req.temperature,
      max_tokens: req.maxTokens
    };
    const tools = this.toolsToWire(req.tools);
    if (tools) body.tools = tools;

    const res = await request({
      method: "POST",
      url: `${base}/chat/completions`,
      headers: this.headers(config),
      body,
      signal: req.signal,
      timeoutMs: 300000
    });
    if (!res.ok) {
      let json: unknown = {};
      try {
        json = await res.json();
      } catch {
        /* ignore */
      }
      throw providerHttpError(res.status, json);
    }

    let text = "";
    let finishReason: ChatCompletionResponse["finishReason"] = "stop";
    let sawLength = false;
    let usage: ChatCompletionResponse["usage"];
    const calls = new Map<number, { id: string; name: string; args: string }>();

    await readSseStream(
      res,
      (payload): SseSignal => {
        if (payload === "[DONE]") return SSE_STOP;
        let chunk: OpenAiStreamChunk;
        try {
          chunk = JSON.parse(payload) as OpenAiStreamChunk;
        } catch {
          return;
        }
        if (chunk.error) throw providerHttpError(200, chunk.error);
        if (chunk.usage) {
          usage = { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens };
        }
        const choice = chunk.choices?.[0];
        if (!choice) return;
        const delta = choice.delta;
        if (delta?.content) {
          text += delta.content;
          req.onTextDelta?.(delta.content);
        }
        for (const tc of delta?.tool_calls ?? []) {
          const entry = calls.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name += tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
          calls.set(tc.index, entry);
        }
        if (choice.finish_reason === "tool_calls") finishReason = "tool_calls";
        else if (choice.finish_reason === "length") sawLength = true;
        if (choice.finish_reason) return SSE_STOP;
      },
      req.signal
    );

    const toolCalls: ToolCall[] = [];
    for (const [, entry] of [...calls.entries()].sort((x, y) => x[0] - y[0])) {
      toolCalls.push(toNormalizedCall(entry));
    }
    if (toolCalls.length > 0 && !sawLength) finishReason = "tool_calls";
    if (sawLength) finishReason = "length";
    return { text, toolCalls, finishReason, usage };
  }

  async testConnection(config: ProviderRuntimeConfig): Promise<ProviderTestResult> {
    const base = resolveBaseUrl(config, this.defaultBaseUrl);
    const started = Date.now();
    try {
      const res = await request({ url: `${base}/models`, headers: this.headers(config), timeoutMs: 15000 });
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        let json: unknown = {};
        try {
          json = await res.json();
        } catch {
          /* ignore */
        }
        const err = providerHttpError(res.status, json);
        return { ok: false, latencyMs, error: err.message, technical: err.message };
      }
      const models = (await res.json().catch(() => null)) as { data?: { id: string }[]; models?: { name?: string; id?: string }[] } | null;
      const ids =
        models?.data?.map((m) => m.id) ??
        models?.models?.map((m) => m.id ?? m.name ?? "").filter((s) => s.length > 0) ??
        undefined;
      return { ok: true, latencyMs, models: ids?.slice(0, 60) };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? describeNetworkError(err) : String(err),
        technical: err instanceof Error ? err.message : String(err)
      };
    }
  }
}

export function toNormalizedCall(entry: { id: string; name: string; args: string }): ToolCall {
  let parsed: Record<string, unknown> = {};
  let rawArguments: string | undefined;
  if (entry.args.trim().length > 0) {
    try {
      parsed = JSON.parse(entry.args) as Record<string, unknown>;
    } catch {
      rawArguments = entry.args;
    }
  }
  return {
    id: entry.id || `call_${Math.random().toString(36).slice(2, 10)}`,
    name: entry.name,
    arguments: parsed,
    rawArguments
  };
}

export function describeNetworkError(err: Error): string {
  const msg = err.message.toLowerCase();
  if (err.name === "AbortError" || msg.includes("abort")) {
    return msg.includes("timed out")
      ? "Connection attempt timed out. The endpoint may be offline or too slow to respond."
      : "The request was cancelled.";
  }
  if (msg.includes("econnrefused")) {
    return "Connection refused. Is the local model server (for example Ollama or LM Studio) running?";
  }
  if (msg.includes("enotfound") || msg.includes("eai_again")) {
    return "Could not resolve the host. Check the base URL and your network connection.";
  }
  return err.message;
}
