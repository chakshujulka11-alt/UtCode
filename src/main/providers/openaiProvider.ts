import { OPENAI_DEFAULT_BASE_URL, OpenAiCompatibleProvider } from "./compatibleProvider";
import type { ProviderRuntimeConfig } from "./providerTypes";

class OpenAiProvider extends OpenAiCompatibleProvider {
  constructor() {
    super("openai", OPENAI_DEFAULT_BASE_URL);
  }

  protected override headers(config: ProviderRuntimeConfig): Record<string, string> {
    return {
      ...super.headers(config),
      "originator": "utcode",
      "version": "1"
    };
  }
}

export const openaiProvider = new OpenAiProvider();
