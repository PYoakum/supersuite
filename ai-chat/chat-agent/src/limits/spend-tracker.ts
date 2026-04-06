import type { AgentConfig } from "../config/schema";

export class SpendTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private maxInput: number;
  private maxOutput: number;

  constructor(config: AgentConfig) {
    this.maxInput = config.limits.spend.max_input_tokens;
    this.maxOutput = config.limits.spend.max_output_tokens;
  }

  record(inputTokens: number, outputTokens: number): void {
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
  }

  isOverBudget(): boolean {
    return this.inputTokens >= this.maxInput || this.outputTokens >= this.maxOutput;
  }

  getUsage() {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      maxInput: this.maxInput,
      maxOutput: this.maxOutput,
    };
  }
}
