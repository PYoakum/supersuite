import type { LLMProvider, LLMCompletionRequest, LLMCompletionResponse, LLMStreamChunk, ToolUseBlock } from "./types";

const DEFAULT_BASE = "https://api.anthropic.com";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl || DEFAULT_BASE;
  }

  private buildBody(req: LLMCompletionRequest): Record<string, unknown> {
    const systemMsg = req.messages.find(m => m.role === "system");

    // Convert our message format to Anthropic's (must alternate user/assistant)
    const messages: Record<string, unknown>[] = [];
    for (const m of req.messages) {
      if (m.role === "system") continue;
      if (m.role === "tool_result") {
        // Group consecutive tool_results into one "user" message
        const prev = messages[messages.length - 1] as any;
        const block = {
          type: "tool_result",
          tool_use_id: m.tool_use_id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        };
        if (prev?.role === "user" && Array.isArray(prev.content) && prev.content[0]?.type === "tool_result") {
          prev.content.push(block);
        } else {
          messages.push({ role: "user", content: [block] });
        }
      } else if (m.role === "assistant" && Array.isArray(m.content)) {
        messages.push({ role: "assistant", content: m.content });
      } else {
        // Merge consecutive user text messages
        const prev = messages[messages.length - 1] as any;
        if (m.role === "user" && prev?.role === "user" && typeof prev.content === "string") {
          prev.content += "\n\n" + (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
        } else {
          messages.push({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
        }
      }
    }

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.max_tokens,
      temperature: req.temperature,
      messages,
    };
    if (systemMsg) {
      body.system = typeof systemMsg.content === "string" ? systemMsg.content : JSON.stringify(systemMsg.content);
    }
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
    }
    return body;
  }

  private get headers() {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  async complete(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(this.buildBody(req)),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    const data = await res.json();

    let textContent = "";
    const toolUse: ToolUseBlock[] = [];

    for (const block of data.content || []) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolUse.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    return {
      content: textContent,
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
      tool_use: toolUse.length > 0 ? toolUse : undefined,
      stop_reason: data.stop_reason,
    };
  }

  async *streamComplete(req: LLMCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    const body = this.buildBody(req);
    body.stream = true;

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const line of sseLines(res)) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));

        if (data.type === "content_block_delta" && data.delta?.text) {
          yield { text: data.delta.text };
        } else if (data.type === "message_start" && data.message?.usage) {
          inputTokens = data.message.usage.input_tokens || 0;
        } else if (data.type === "message_delta" && data.usage) {
          outputTokens = data.usage.output_tokens || 0;
        }
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
