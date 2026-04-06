export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool_result";
  content: string | LLMContentBlock[];
  tool_use_id?: string;
}

export interface LLMContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LLMCompletionRequest {
  messages: LLMMessage[];
  max_tokens: number;
  temperature: number;
  tools?: ToolSchema[];
}

export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMCompletionResponse {
  content: string;
  input_tokens: number;
  output_tokens: number;
  tool_use?: ToolUseBlock[];
  stop_reason?: string;
}

export interface LLMStreamChunk {
  text?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface LLMProvider {
  name: string;
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;
  streamComplete?(request: LLMCompletionRequest): AsyncGenerator<LLMStreamChunk>;
}
