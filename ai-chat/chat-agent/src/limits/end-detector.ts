import type { AgentConfig } from "../config/schema";

export class EndDetector {
  private keywords: string[];

  constructor(config: AgentConfig) {
    this.keywords = config.limits.session.end_keywords.map(k => k.toLowerCase());
  }

  check(content: string): { ended: boolean; keyword: string } {
    const lower = content.toLowerCase();
    for (const kw of this.keywords) {
      if (lower.includes(kw)) {
        return { ended: true, keyword: kw };
      }
    }
    return { ended: false, keyword: "" };
  }
}
