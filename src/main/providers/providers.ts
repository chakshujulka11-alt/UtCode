import type { ProviderConfig, ProviderTestResult, ProviderType, ToolDefinition } from "../../shared/types";
import { logger } from "../services/logger";
import { settingsStore } from "../services/settingsStore";
import { anthropicProvider } from "./anthropicProvider";
import { OpenAiCompatibleProvider } from "./compatibleProvider";
import { geminiProvider } from "./geminiProvider";
import { openaiProvider } from "./openaiProvider";
import {
  ProviderError,
  type AiProvider,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ProviderRuntimeConfig
} from "./providerTypes";

export type { AiProvider, ChatCompletionRequest, ChatCompletionResponse, ProviderRuntimeConfig };
export { ProviderError };

export class RuntimeAiProvider {
  readonly type: ProviderType;
  private readonly config: ProviderRuntimeConfig;
  private readonly impl: AiProvider;

  constructor(config: ProviderRuntimeConfig) {
    this.config = config;
    this.type = config.type;
    switch (config.type) {
      case "anthropic":
        this.impl = anthropicProvider;
        break;
      case "gemini":
        this.impl = geminiProvider;
        break;
      case "openai":
        this.impl = openaiProvider;
        break;
      default:
        this.impl = new OpenAiCompatibleProvider("openai-compatible");
    }
  }

  get temperature(): number {
    return this.config.temperature;
  }

  get maxTokens(): number {
    return this.config.maxTokens;
  }

  get model(): string {
    return this.config.model;
  }

  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.impl.complete(this.config, {
      ...request,
      model: request.model || this.config.model
    });
  }

  testConnection(): Promise<ProviderTestResult> {
    return this.impl.testConnection(this.config);
  }
}

function buildRuntimeConfig(provider: ProviderConfig): ProviderRuntimeConfig {
  const agent = settingsStore.agentSettings;
  const apiKey = settingsStore.getApiKey(provider.id);
  if (!apiKey && provider.type !== "openai-compatible") {
    throw new ProviderError(`No API key is configured for provider "${provider.name}".`);
  }
  if (!provider.model?.trim()) {
    throw new ProviderError(`No model is configured for provider "${provider.name}".`);
  }
  return {
    type: provider.type,
    model: provider.model,
    apiKey,
    baseUrl: provider.baseUrl,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens
  };
}

export const providerManager = {
  listEnabled(): ProviderConfig[] {
    return settingsStore.getPublicProviders().filter((p) => p.enabled);
  },

  resolveRuntimeProvider(providerId?: string | null, modelOverride?: string): RuntimeAiProvider {
    const settings = settingsStore.get();
    const id = providerId ?? settings.activeProviderId ?? settings.defaultProviderId;
    const all = settingsStore.getPublicProviders();
    const provider = id ? all.find((p) => p.id === id) : all.find((p) => p.enabled);
    if (!provider) {
      throw new ProviderError(
        "No AI provider is configured. Open Settings and add a provider (OpenAI, Anthropic, Gemini, OpenRouter, Groq, Ollama, …)."
      );
    }
    if (!provider.enabled) {
      throw new ProviderError(`Provider "${provider.name}" is disabled. Enable it in Settings.`);
    }
    const config = buildRuntimeConfig(provider);
    if (modelOverride && modelOverride.trim().length > 0) config.model = modelOverride.trim();
    return new RuntimeAiProvider(config);
  },

  getProviderForId(id: string): ProviderConfig {
    const provider = settingsStore.getPublicProviders().find((p) => p.id === id);
    if (!provider) throw new ProviderError(`Unknown provider: ${id}`);
    return provider;
  },

  async test(id: string): Promise<ProviderTestResult> {
    const provider = this.getProviderForId(id);
    try {
      const runtime = new RuntimeAiProvider(buildRuntimeConfig(provider));
      const result = await runtime.testConnection();
      logger.info("providers", `Test ${provider.name}: ${result.ok ? "ok" : "failed"}`);
      return result;
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  },

  async fetchModels(id: string): Promise<string[]> {
    const provider = this.getProviderForId(id);
    const runtime = new RuntimeAiProvider(buildRuntimeConfig(provider));
    const result = await runtime.testConnection();
    if (!result.ok) {
      throw new Error(result.error ?? "Provider could not be reached. Fix the connection before fetching models.");
    }
    const models = (result.models ?? []).filter((m) => typeof m === "string" && m.length > 0);
    settingsStore.setProviderModels(id, models);
    return models;
  },

  toolCount(tools: ToolDefinition[]): number {
    return tools.length;
  }
};
