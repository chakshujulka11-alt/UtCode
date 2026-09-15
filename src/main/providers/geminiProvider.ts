import { request, providerHttpError, readSseStream, SSE_STOP, type SseSignal } from "./http";
import { describeNetworkError } from "./compatibleProvider";
import {
  buildSystemPromptText,
  nonSystemMessages,
  ProviderError,
  type AiProvider,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ProviderRuntimeConfig,
  type ToolCall
} from "./providerTypes";
import type { ProviderTestResult } from "../../shared/types";

const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiPart {
  text?: string;
  /** Gemini 2.5 thinking models mark internal reasoning parts; never surface them. */
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name?: string; response?: Record<string, unknown> };
}

interface GeminiChunk {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: unknown;
}

const GEMINI_BLOCKED_REASONS = new Set(["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"]);

export class GeminiProvider implements AiProvider {
  readonly type = "gemini" as const;

  private baseUrl(config: ProviderRuntimeConfig): string {
    return (config.baseUrl?.trim() || GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private toBody(req: ChatCompletionRequest): Record<string, unknown> {
    const contents: Record<string, unknown>[] = [];
    const callNames = new Map<string, string>();
    let pendingResponses: GeminiPart[] = [];
    const flush = (): void => {
      if (pendingResponses.length > 0) {
        contents.push({ role: "user", parts: pendingResponses });
        pendingResponses = [];
      }
    };
    for (const m of nonSystemMessages(req.messages)) {
      if (m.role === "user") {
        flush();
        contents.push({ role: "user", parts: [{ text: m.content }] });
      } else if (m.role === "assistant") {
        flush();
        const parts: GeminiPart[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const tc of m.toolCalls ?? []) {
          callNames.set(tc.id, tc.name);
          parts.push({
            functionCall: { name: tc.name, args: tc.arguments ?? {} },
            // Gemini 2.5 rejects/derails follow-ups when the call's thoughtSignature
            // is not echoed back exactly as received.
            ...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {})
          });
        }
        if (parts.length === 0) parts.push({ text: "" });
        contents.push({ role: "model", parts });
      } else if (m.role === "tool") {
        const name = m.toolName ?? (m.toolCallId ? callNames.get(m.toolCallId) ?? "tool" : "tool");
        pendingResponses.push({ functionResponse: { name, response: { output: m.content } } });
      }
    }
    flush();
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens
      }
    };
    const system = buildSystemPromptText(req.messages);
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (req.tools && req.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: sanitizeSchema(t.parameters)
          }))
        }
      ];
    }
    return body;
  }

  async complete(config: ProviderRuntimeConfig, req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl(config)}/models/${encodeURIComponent(req.model || config.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(config.apiKey)}`;
    const res = await request({
      method: "POST",
      url,
      body: this.toBody(req),
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
    let usage: ChatCompletionResponse["usage"];
    let blockedReason: string | null = null;
    const toolCalls: ToolCall[] = [];
    let callSeq = 0;

    await readSseStream(
      res,
      (payload): SseSignal => {
        let chunk: GeminiChunk;
        try {
          chunk = JSON.parse(payload) as GeminiChunk;
        } catch {
          return;
        }
        if (chunk.error) throw providerHttpError(200, chunk.error);
        if (chunk.usageMetadata) {
          usage = {
            promptTokens: chunk.usageMetadata.promptTokenCount,
            completionTokens: chunk.usageMetadata.candidatesTokenCount
          };
        }
        const candidate = chunk.candidates?.[0];
        if (!candidate) return;
        for (const part of candidate.content?.parts ?? []) {
          if (part.thought === true) continue; // internal reasoning — never shown, never stored
          if (part.text) {
            text += part.text;
            req.onTextDelta?.(part.text);
          } else if (part.functionCall?.name) {
            callSeq++;
            toolCalls.push({
              id: `gemini_call_${Date.now().toString(36)}_${callSeq}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args ?? {},
              ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {})
            });
            finishReason = "tool_calls";
          }
        }
        if (candidate.finishReason === "MAX_TOKENS") finishReason = "length";
        if (candidate.finishReason && GEMINI_BLOCKED_REASONS.has(candidate.finishReason)) {
          blockedReason = candidate.finishReason;
        }
        if (candidate.finishReason) return SSE_STOP;
      },
      req.signal
    );

    if (
      blockedReason &&
      text.trim().length === 0 &&
      toolCalls.length === 0
    ) {
      throw new ProviderError(
        `Gemini blocked the response (${blockedReason}). Rephrase the task or adjust the content — the agent stopped instead of looping on an empty reply.`
      );
    }
    return { text, toolCalls, finishReason: toolCalls.length > 0 ? "tool_calls" : finishReason, usage };
  }

  async testConnection(config: ProviderRuntimeConfig): Promise<ProviderTestResult> {
    const started = Date.now();
    try {
      const res = await request({
        url: `${this.baseUrl(config)}/models?key=${encodeURIComponent(config.apiKey)}&pageSize=10`,
        timeoutMs: 15000
      });
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
      const payload = (await res.json().catch(() => null)) as { models?: { name: string }[] } | null;
      return {
        ok: true,
        latencyMs,
        models: payload?.models?.map((m) => m.name.replace(/^models\//, "")) ?? []
      };
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

function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  const strip = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(strip);
      return;
    }
    const obj = node as Record<string, unknown>;
    delete obj.$schema;
    delete obj.$defs;
    delete obj.definitions;
    delete obj.additionalProperties;
    for (const key of Object.keys(obj)) strip(obj[key]);
  };
  strip(copy);
  if (typeof copy.type === "string") copy.type = copy.type.toLowerCase();
  return copy;
}

export const geminiProvider = new GeminiProvider();
