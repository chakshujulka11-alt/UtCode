import type { ProviderTestResult, ProviderType, ToolDefinition } from "../../shared/types";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments?: string;
  /** Gemini 2.5 thinking models attach a signature to function calls; it must
   * be echoed back on the next request or the model fails/answers silently. */
  thoughtSignature?: string;
}

export interface UnifiedMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface ProviderRuntimeConfig {
  type: ProviderType;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
}

export interface ChatCompletionRequest {
  model: string;
  messages: UnifiedMessage[];
  tools?: ToolDefinition[];
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
}

export interface ChatCompletionResponse {
  text: string;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  usage?: { promptTokens?: number; completionTokens?: number };
  raw?: unknown;
}

export interface AiProvider {
  readonly type: ProviderType;
  complete(config: ProviderRuntimeConfig, request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  testConnection(config: ProviderRuntimeConfig): Promise<ProviderTestResult>;
}

export class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export function buildSystemPromptText(messages: UnifiedMessage[]): string | undefined {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content);
  return system.length ? system.join("\n\n") : undefined;
}

export function nonSystemMessages(messages: UnifiedMessage[]): UnifiedMessage[] {
  return messages.filter((m) => m.role !== "system");
}
