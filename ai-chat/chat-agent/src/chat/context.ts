import type { ChatMessage } from "./history";
import type { LLMMessage, LLMContentBlock } from "../providers/types";
import type { AgentConfig } from "../config/schema";

type ContextEntry =
  | { kind: "chat"; msg: ChatMessage }
  | { kind: "raw"; llmMsg: LLMMessage };

export class ContextManager {
  private entries: ContextEntry[] = [];
  private config: AgentConfig;
  private systemPrompt: string;
  private ownSenderId: string;

  constructor(config: AgentConfig, systemPrompt: string) {
    this.config = config;
    this.systemPrompt = systemPrompt;
    this.ownSenderId = config.identity.sender_id;
  }

  addMessage(msg: ChatMessage): void {
    if (!this.config.context.include_own_messages && msg.senderId === this.ownSenderId) {
      return;
    }
    this.entries.push({ kind: "chat", msg });
    this.trim();
  }

  /** Add a raw LLM message (tool_use / tool_result blocks) directly into context */
  addRawLLMMessage(llmMsg: LLMMessage): void {
    this.entries.push({ kind: "raw", llmMsg });
    this.trim();
  }

  addHistory(msgs: ChatMessage[]): void {
    for (const msg of msgs) {
      this.addMessage(msg);
    }
  }

  clear(): void {
    this.entries = [];
  }

  toLLMMessages(): LLMMessage[] {
    const result: LLMMessage[] = [
      { role: "system", content: this.systemPrompt },
    ];

    let charCount = this.systemPrompt.length;
    const maxChars = this.config.context.max_chars;

    const selected: LLMMessage[] = [];
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      const llmMsg = entry.kind === "raw" ? entry.llmMsg : this.chatToLLM(entry.msg);
      const entryChars = this.estimateChars(llmMsg);
      if (charCount + entryChars > maxChars) break;
      charCount += entryChars;
      selected.unshift(llmMsg);
    }

    return result.concat(selected);
  }

  private chatToLLM(msg: ChatMessage): LLMMessage {
    const isOwn = msg.senderId === this.ownSenderId;
    if (isOwn) {
      return { role: "assistant", content: msg.content };
    }
    return { role: "user", content: `[${msg.displayName}] ${msg.content}` };
  }

  private estimateChars(msg: LLMMessage): number {
    if (typeof msg.content === "string") return msg.content.length;
    if (Array.isArray(msg.content)) {
      return msg.content.reduce((sum, block) => {
        if (block.text) return sum + block.text.length;
        if (block.content) return sum + block.content.length;
        return sum + 100; // estimate for tool_use blocks
      }, 0);
    }
    return 100;
  }

  private trim(): void {
    if (this.entries.length > this.config.context.max_messages) {
      this.entries = this.entries.slice(-this.config.context.max_messages);
    }
  }
}
