import { request, providerHttpError, readSseStream, SSE_STOP, type SseSignal } from "./http";
import {
  buildSystemPromptText,
  nonSystemMessages,
  type AiProvider,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ProviderRuntimeConfig,
  type ToolCall
} from "./providerTypes";
import type { ProviderTestResult } from "../../shared/types";
import { describeNetworkError } from "./compatibleProvider";

const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  partial_json?: string;
}

export class AnthropicProvider implements AiProvider {
  readonly type = "anthropic" as const;

  private baseUrl(config: ProviderRuntimeConfig): string {
    const raw = (config.baseUrl?.trim() || ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, "");
    return raw.endsWith("/v1") ? raw : `${raw}/v1`;
  }

  private headers(config: ProviderRuntimeConfig): Record<string, string> {
    return {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    };
  }

  private toWire(req: ChatCompletionRequest): Record<string, unknown> {
    const contents: Record<string, unknown>[] = [];
    let pendingToolResults: AnthropicBlock[] = [];
    const flushToolResults = (): void => {
      if (pendingToolResults.length > 0) {
        contents.push({ role: "user", content: pendingToolResults });
        pendingToolResults = [];
      }
    };
    for (const m of nonSystemMessages(req.messages)) {
      if (m.role === "user") {
        flushToolResults();
        contents.push({ role: "user", content: m.content });
      } else if (m.role === "assistant") {
        flushToolResults();
        const blocks: AnthropicBlock[] = [];
        if (m.content && m.content.length > 0) blocks.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls ?? []) {
          blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments ?? {} });
        }
        if (blocks.length === 0) blocks.push({ type: "text", text: "" });
        contents.push({ role: "assistant", content: blocks });
      } else if (m.role === "tool") {
        pendingToolResults.push({
          type: "tool_result",
          tool_use_id: m.toolCallId ?? "",
          content: m.content
        });
      }
    }
    flushToolResults();
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      stream: true,
      messages: contents
    };
    const system = buildSystemPromptText(req.messages);
    if (system) body.system = system;
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }
    return body;
  }

  async complete(config: ProviderRuntimeConfig, req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const res = await request({
      method: "POST",
      url: `${this.baseUrl(config)}/messages`,
      headers: this.headers(config),
      body: this.toWire(req),
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
    const toolCalls: ToolCall[] = [];
    const accumulators = new Map<number, { id: string; name: string; json: string }>();
    const capturedUsage: { promptTokens?: number; completionTokens?: number } = {};

    await readSseStream(
      res,
      (payload): SseSignal => {
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          return;
        }
        const type = evt.type as string;
        if (evt.type === "error") {
          throw providerHttpError(200, evt.error ?? evt);
        }
        if (type === "content_block_start") {
          const block = evt.content_block as AnthropicBlock;
          if (block.type === "tool_use") {
            accumulators.set(Number(evt.index), { id: block.id ?? "", name: block.name ?? "", json: "" });
          }
        } else if (type === "content_block_delta") {
          const delta = evt.delta as AnthropicBlock;
          if (delta.type === "text_delta" && delta.text) {
            text += delta.text;
            req.onTextDelta?.(delta.text);
          } else if (delta.type === "input_json_delta" && delta.partial_json) {
            const acc = accumulators.get(Number(evt.index));
            if (acc) acc.json += delta.partial_json;
          }
        } else if (type === "message_delta") {
          const sr = (evt.delta as Record<string, unknown>)?.stop_reason as string | undefined;
          if (sr === "tool_use") finishReason = "tool_calls";
          else if (sr === "max_tokens") finishReason = "length";
        } else if (type === "message_start") {
          const usage = (evt.message as Record<string, unknown>)?.usage as Record<string, number> | undefined;
          if (usage) {
            capturedUsage.promptTokens = usage.input_tokens;
            capturedUsage.completionTokens = usage.output_tokens;
          }
        } else if (type === "message_stop") {
          return SSE_STOP;
        }
      },
      req.signal
    );

    for (const [, acc] of [...accumulators.entries()].sort((a, b) => a[0] - b[0])) {
      let parsed: Record<string, unknown> = {};
      let rawArguments: string | undefined;
      if (acc.json.trim().length > 0) {
        try {
          parsed = JSON.parse(acc.json) as Record<string, unknown>;
        } catch {
          rawArguments = acc.json;
        }
      }
      toolCalls.push({ id: acc.id || `toolu_${Math.random().toString(36).slice(2, 10)}`, name: acc.name, arguments: parsed, rawArguments });
    }
    if (toolCalls.length > 0) finishReason = "tool_calls";
    return {
      text,
      toolCalls,
      finishReason,
      usage: capturedUsage.promptTokens !== undefined ? capturedUsage : undefined
    };
  }

  async testConnection(config: ProviderRuntimeConfig): Promise<ProviderTestResult> {
    const started = Date.now();
    try {
      const res = await request({
        method: "POST",
        url: `${this.baseUrl(config)}/messages`,
        headers: this.headers(config),
        body: {
          model: config.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }]
        },
        timeoutMs: 20000
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
      return { ok: true, latencyMs };
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

export const anthropicProvider = new AnthropicProvider();
