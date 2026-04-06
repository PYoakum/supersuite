import type { AgentConfig } from "../config/schema";
import type { LLMProvider } from "./types";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { GeminiProvider } from "./gemini";

export function createProvider(config: AgentConfig, apiKey: string): LLMProvider {
  const { provider, model, base_url } = config.llm;
  const guardrailsUrl = config.guardrails.enabled ? config.guardrails.proxy_url : "";

  switch (provider) {
    case "anthropic":
      return new AnthropicProvider(apiKey, model, guardrailsUrl || undefined);

    case "openai":
      return new OpenAIProvider(apiKey, model, guardrailsUrl || undefined);

    case "gemini":
      return new GeminiProvider(apiKey, model, guardrailsUrl || undefined);

    case "openai-compat": {
      const url = guardrailsUrl || base_url;
      if (!url) {
        throw new Error("openai-compat provider requires llm.base_url or guardrails.proxy_url");
      }
      return new OpenAIProvider(apiKey, model, url, "openai-compat");
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
