import type { LLMProvider, LLMCompletionRequest, LLMCompletionResponse, LLMStreamChunk, ToolUseBlock } from "./types";

const DEFAULT_BASE = "https://api.openai.com";

export class OpenAIProvider implements LLMProvider {
  name: string;
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private isCompat: boolean;

  constructor(apiKey: string, model: string, baseUrl?: string, name?: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl || DEFAULT_BASE;
    this.name = name || "openai";
    this.isCompat = this.name === "openai-compat";
  }

  private buildBody(req: LLMCompletionRequest, stream = false): Record<string, unknown> {
    // Convert messages to OpenAI format
    const messages: Record<string, unknown>[] = [];
    for (const m of req.messages) {
      if (m.role === "tool_result") {
        messages.push({
          role: "tool",
          tool_call_id: m.tool_use_id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
      } else if (m.role === "assistant" && Array.isArray(m.content)) {
        let text = "";
        const toolCalls: Record<string, unknown>[] = [];
        for (const block of m.content) {
          if (block.type === "text" && block.text) text += block.text;
          if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: { name: block.name, arguments: JSON.stringify(block.input) },
            });
          }
        }
        const msg: Record<string, unknown> = { role: "assistant" };
        if (text) msg.content = text;
        else msg.content = null;
        if (toolCalls.length > 0) msg.tool_calls = toolCalls;
        messages.push(msg);
      } else {
        messages.push({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
      }
    }

    const tokenParam = this.isCompat
      ? { max_tokens: req.max_tokens }
      : { max_completion_tokens: req.max_tokens };

    const body: Record<string, unknown> = {
      model: this.model,
      ...tokenParam,
      temperature: req.temperature,
      messages,
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    };

    // Convert tool schemas to OpenAI function calling format
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    return body;
  }

  private get headers() {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  async complete(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(this.buildBody(req)),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${this.name} API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const content = choice?.message?.content || "";

    // Extract tool calls
    const toolUse: ToolUseBlock[] = [];
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        if (tc.type === "function") {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments); } catch {}
          toolUse.push({ id: tc.id, name: tc.function.name, input });
        }
      }
    }

    return {
      content,
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
      tool_use: toolUse.length > 0 ? toolUse : undefined,
      stop_reason: choice?.finish_reason === "tool_calls" ? "tool_use" : choice?.finish_reason,
    };
  }

  async *streamComplete(req: LLMCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(this.buildBody(req, true)),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${this.name} API error ${res.status}: ${text}`);
    }

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const line of sseLines(res)) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") break;

      const data = JSON.parse(payload);

      const delta = data.choices?.[0]?.delta?.content;
      if (delta) yield { text: delta };

      if (data.usage) {
        inputTokens = data.usage.prompt_tokens || 0;
        outputTokens = data.usage.completion_tokens || 0;
      }
    }

    yield { usage: { input_tokens: inputTokens, output_tokens: outputTokens } };
  }
}

async function* sseLines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) yield trimmed;
    }
  }

  if (buf.trim()) yield buf.trim();
}
