export const config = {
  port: Number(process.env.PORT || 3200),
  host: process.env.HOST || "0.0.0.0",

  // LLM defaults (overridable per-request)
  defaultProvider: (process.env.LLM_PROVIDER || "anthropic") as
    "anthropic" | "openai" | "gemini" | "openai-compat",
  defaultModel: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
  apiKeyEnv: process.env.LLM_API_KEY_ENV || "LLM_API_KEY",
  baseUrl: process.env.LLM_BASE_URL || "",
  chatServerUrl: process.env.CHAT_SERVER_URL || "http://localhost:3000",
  taskServerUrl: process.env.TASK_SERVER_URL || "http://localhost:3001",
  maxTokens: Number(process.env.LLM_MAX_TOKENS || 16384),
  temperature: Number(process.env.LLM_TEMPERATURE || 0.3),
  maxTeamSize: Number(process.env.MAX_TEAM_SIZE || 8),
  projectTokenBudget: Number(process.env.PROJECT_TOKEN_BUDGET || 20000000),
};
