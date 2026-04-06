import { readFileSync, existsSync } from "fs";
import { parse } from "smol-toml";
import { AgentConfigSchema, type AgentConfig } from "./schema";
import { log } from "../logger";

export function loadConfig(path: string): AgentConfig {
  if (!existsSync(path)) {
    log.error(`Config file not found: ${path}`);
    process.exit(1);
  }

  const raw = readFileSync(path, "utf-8");
  let parsed: Record<string, unknown>;

  try {
    parsed = parse(raw);
  } catch (err) {
    log.error(`Failed to parse TOML: ${err}`);
    process.exit(1);
  }

  const result = AgentConfigSchema.safeParse(parsed);
  if (!result.success) {
    log.error("Config validation failed:");
    for (const issue of result.error.issues) {
      log.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

const PROVIDER_KEY_VARS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
};

export function resolveApiKey(config: AgentConfig): string {
  const { api_key_env } = config.llm;
  const key = process.env[api_key_env] || "";
  if (key) return key;

  // Fall back to well-known provider env vars
  const fallbacks = PROVIDER_KEY_VARS[config.llm.provider] || [];
  for (const name of fallbacks) {
    if (name !== api_key_env && process.env[name]) {
      log.info(`Using ${name} (${api_key_env} not set)`);
      return process.env[name]!;
    }
  }

  if (config.llm.provider !== "openai-compat") {
    log.warn(`No API key found — set ${api_key_env} or ${fallbacks.join("/")}`);
  }
  return "";
}
