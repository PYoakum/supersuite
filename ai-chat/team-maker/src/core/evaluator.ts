import type { LLMProvider, LLMCompletionRequest, LLMStreamChunk } from "../../../chat-agent/src/providers/types";
import { AnthropicProvider } from "../../../chat-agent/src/providers/anthropic";
import { OpenAIProvider } from "../../../chat-agent/src/providers/openai";
import { GeminiProvider } from "../../../chat-agent/src/providers/gemini";
import type { EvaluateRequest, EvaluateResponse } from "./schema";
import { buildMessages } from "./prompt-builder";
import { parseResponse } from "./response-parser";
import { validateResponse } from "./validator";
import { generatePMRoles } from "./pm-generator";
import { config } from "../config";
import { setLastResult } from "../routes/roles";

const PROVIDER_KEY_MAP: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  "openai-compat": "OPENAI_API_KEY",
};

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  gemini: "gemini-2.5-flash",
};

function resolveApiKey(provider: string): string {
  // 1. Check the provider-specific env var first
  const providerVar = PROVIDER_KEY_MAP[provider];
  if (providerVar && process.env[providerVar]) {
    return process.env[providerVar]!;
  }

  // 2. Check the configured generic env var
  const configured = process.env[config.apiKeyEnv];
  if (configured) return configured;

  const hint = providerVar
    ? `${providerVar} or ${config.apiKeyEnv}`
    : config.apiKeyEnv;
  throw new Error(`API key not found for ${provider}. Set ${hint}.`);
}

export function createProvider(
  providerName?: string,
  model?: string,
  baseUrl?: string,
): LLMProvider {
  const name = providerName || config.defaultProvider;
  const modelId = model || DEFAULT_MODELS[name] || config.defaultModel;
  const apiKey = resolveApiKey(name);

  switch (name) {
    case "anthropic":
      return new AnthropicProvider(apiKey, modelId);
    case "openai":
      return new OpenAIProvider(apiKey, modelId);
    case "gemini":
      return new GeminiProvider(apiKey, modelId);
    case "openai-compat": {
      const url = baseUrl || config.baseUrl;
      if (!url) {
        throw new Error("openai-compat provider requires LLM_BASE_URL or baseUrl");
      }
      return new OpenAIProvider(apiKey, modelId, url, "openai-compat");
    }
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

/**
 * Run the full evaluation pipeline:
 * 1. Build LLM messages from request
 * 2. Send to LLM provider
 * 3. Parse structured response
 * 4. Validate coverage
 */
export async function evaluate(
  request: EvaluateRequest
): Promise<{ response: EvaluateResponse; validation: ReturnType<typeof validateResponse> }> {
  const provider = createProvider(request.provider, request.model);
  const messages = buildMessages(request);

  // Scale token budget: base + per-role overhead
  const totalRoles = request.aiAgentCount + request.humanCount;
  const maxTokens = Math.max(config.maxTokens, 4096 + totalRoles * 1500);

  const completion = await provider.complete({
    messages,
    max_tokens: maxTokens,
    temperature: config.temperature,
  });

  const parsed = parseResponse(completion.content);
  const response = generatePMRoles(parsed);
  response.usage = {
    input_tokens: completion.input_tokens,
    output_tokens: completion.output_tokens,
  };

  const validation = validateResponse(response, request);

  return { response, validation };
}

/**
 * Streaming variant — yields SSE-formatted events as the LLM responds,
 * then sends a final "done" event with parsed results.
 */
export function evaluateStream(request: EvaluateRequest): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  function sse(event: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  return new ReadableStream({
    async start(controller) {
      try {
        const provider = createProvider(request.provider, request.model);
        const messages = buildMessages(request);

        const totalRoles = request.aiAgentCount + request.humanCount;
        const maxTokens = Math.max(config.maxTokens, 4096 + totalRoles * 1500);

        const completionReq: LLMCompletionRequest = {
          messages,
          max_tokens: maxTokens,
          temperature: config.temperature,
        };

        // Use streaming if provider supports it, else fall back to non-stream
        if (provider.streamComplete) {
          let fullText = "";
          let usage = { input_tokens: 0, output_tokens: 0 };

          for await (const chunk of provider.streamComplete(completionReq)) {
            if (chunk.text) {
              fullText += chunk.text;
              controller.enqueue(sse("chunk", { text: chunk.text }));
            }
            if (chunk.usage) {
              usage = chunk.usage;
            }
          }

          const parsed = parseResponse(fullText);
          const response = generatePMRoles(parsed);
          response.usage = usage;
          const validation = validateResponse(response, request);
          setLastResult(response);
          controller.enqueue(sse("done", { ok: true, ...response, validation }));
        } else {
          // Non-streaming fallback
          const completion = await provider.complete(completionReq);
          controller.enqueue(sse("chunk", { text: completion.content }));

          const parsed = parseResponse(completion.content);
          const response = generatePMRoles(parsed);
          response.usage = {
            input_tokens: completion.input_tokens,
            output_tokens: completion.output_tokens,
          };
          const validation = validateResponse(response, request);
          setLastResult(response);
          controller.enqueue(sse("done", { ok: true, ...response, validation }));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Evaluation failed";
        controller.enqueue(sse("error", { errors: [message] }));
      } finally {
        controller.close();
      }
    },
  });
}
