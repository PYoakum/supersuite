import type { LLMProvider, LLMCompletionRequest, LLMCompletionResponse, ToolUseBlock } from "./types";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com";

export class GeminiProvider implements LLMProvider {
  name = "gemini";
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl || DEFAULT_BASE;
  }

  async complete(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const systemMsg = req.messages.find(m => m.role === "system");

    const contents: Record<string, unknown>[] = [];
    for (const m of req.messages) {
      if (m.role === "system") continue;

      if (m.role === "tool_result") {
        contents.push({
          role: "user",
          parts: [{
            functionResponse: {
              name: (m as any)._toolName || "tool",
              response: { result: typeof m.content === "string" ? m.content : JSON.stringify(m.content) },
            },
          }],
        });
      } else if (m.role === "assistant" && Array.isArray(m.content)) {
        const parts: Record<string, unknown>[] = [];
        for (const block of m.content) {
          if (block.type === "text" && block.text) parts.push({ text: block.text });
          if (block.type === "tool_use") {
            parts.push({ functionCall: { name: block.name, args: block.input } });
          }
        }
        contents.push({ role: "model", parts });
      } else {
        contents.push({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
        });
      }
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: req.max_tokens,
        temperature: req.temperature,
      },
    };

    if (systemMsg) {
      const sysText = typeof systemMsg.content === "string" ? systemMsg.content : JSON.stringify(systemMsg.content);
      body.systemInstruction = { parts: [{ text: sysText }] };
    }

    // Convert tool schemas to Gemini function declarations
    if (req.tools && req.tools.length > 0) {
      body.tools = [{
        functionDeclarations: req.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
      }];
    }

    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const usage = data.usageMetadata || {};

    let textContent = "";
    const toolUse: ToolUseBlock[] = [];

    for (const part of parts) {
      if (part.text) {
        textContent += part.text;
      } else if (part.functionCall) {
        toolUse.push({
          id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: part.functionCall.name,
          input: part.functionCall.args || {},
        });
      }
    }

    const finishReason = data.candidates?.[0]?.finishReason;

    return {
      content: textContent,
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
      tool_use: toolUse.length > 0 ? toolUse : undefined,
      stop_reason: finishReason === "STOP" ? "end_turn" : finishReason === "FUNCTION_CALL" ? "tool_use" : finishReason,
    };
  }
}
