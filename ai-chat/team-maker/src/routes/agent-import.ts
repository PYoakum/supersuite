import { join } from "path";
import { readdirSync, readFileSync, existsSync } from "fs";
import { getLastResult, setLastResult } from "./roles";
import type { EvaluateResponse, RoleAssignment, GeneratedPrompt } from "../core/schema";

const CHAT_AGENT_DIR = join(import.meta.dir, "..", "..", "..", "chat-agent");
const TEAM_MAKER_AGENTS = join(import.meta.dir, "..", "..", "agents");

interface AgentSummary {
  file: string;
  senderId: string;
  displayName: string;
  role: string;
  provider: string;
  model: string;
  prompt: string;
  tags: string[];
  source: "chat-agent" | "team-maker";
}

function parseTOML(content: string): Record<string, any> {
  // Lightweight TOML parser for the fields we need
  const result: Record<string, any> = {};
  let currentSection = "";

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = `${currentSection}.${kvMatch[1]}`;
      let val = kvMatch[2].trim();
      // Strip quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // Handle multiline """
      if (val === '"""') continue;
      result[key] = val;
    }
  }

  // Extract multiline template
  const templateMatch = content.match(/template\s*=\s*"""([\s\S]*?)"""/);
  if (templateMatch) {
    result["prompt.template"] = templateMatch[1].trim();
  }
  // Also handle single-line template = "..."
  if (!result["prompt.template"]) {
    const singleMatch = content.match(/template\s*=\s*"((?:[^"\\]|\\.)*)"/);
    if (singleMatch) {
      result["prompt.template"] = singleMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }

  return result;
}

function scanConfigs(): AgentSummary[] {
  const configs: AgentSummary[] = [];

  // Scan chat-agent configs
  const chatAgentPaths: string[] = [];
  const mainConfig = join(CHAT_AGENT_DIR, "agent.toml");
  if (existsSync(mainConfig)) chatAgentPaths.push(mainConfig);
  const chatAgentsDir = join(CHAT_AGENT_DIR, "agents");
  if (existsSync(chatAgentsDir)) {
    for (const f of readdirSync(chatAgentsDir)) {
      if (f.endsWith(".toml")) chatAgentPaths.push(join(chatAgentsDir, f));
    }
  }

  for (const path of chatAgentPaths) {
    const summary = parseConfig(path, "chat-agent");
    if (summary) configs.push(summary);
  }

  // Scan team-maker generated configs
  if (existsSync(TEAM_MAKER_AGENTS)) {
    for (const f of readdirSync(TEAM_MAKER_AGENTS)) {
      if (f.endsWith(".toml")) {
        const summary = parseConfig(join(TEAM_MAKER_AGENTS, f), "team-maker");
        if (summary) configs.push(summary);
      }
    }
  }

  return configs;
}

function parseConfig(path: string, source: "chat-agent" | "team-maker"): AgentSummary | null {
  try {
    const content = readFileSync(path, "utf-8");
    const parsed = parseTOML(content);

    return {
      file: path,
      senderId: parsed["identity.sender_id"] || "",
      displayName: parsed["identity.display_name"] || parsed["identity.sender_id"] || "",
      role: parsed["identity.role"] || "",
      provider: parsed["llm.provider"] || "anthropic",
      model: parsed["llm.model"] || "",
      prompt: parsed["prompt.template"] || "",
      tags: (parsed["identity.tags"] || "").replace(/[\[\]"]/g, "").split(",").map((s: string) => s.trim()).filter(Boolean),
      source,
    };
  } catch {
    return null;
  }
}

/**
 * GET /api/agents/configs — list all discoverable agent configs
 */
export function handleListConfigs(): Response {
  const configs = scanConfigs();
  return Response.json({ ok: true, configs });
}

/**
 * POST /api/agents/import — import agent configs into current evaluation result
 * Body: { files: string[] } — paths to import, or omit for all
 */
export async function handleImportConfigs(req: Request): Promise<Response> {
  let body: { files?: string[] } = {};
  try { body = await req.json(); } catch {}

  const allConfigs = scanConfigs();
  const configs = body.files
    ? allConfigs.filter(c => body.files!.includes(c.file))
    : allConfigs;

  if (configs.length === 0) {
    return Response.json({ ok: false, errors: ["No configs found to import"] }, { status: 400 });
  }

  // Get or create a result to merge into
  let result = getLastResult();
  if (!result) {
    result = {
      summary: "Imported from agent configs",
      tasks: [],
      assignments: [],
      prompts: [],
      coverageReport: { coveredTaskIds: [], uncoveredTaskIds: [], notes: [] },
      ambiguities: [],
    };
  }

  let imported = 0;
  for (const cfg of configs) {
    // Skip if already exists
    if (result.assignments.some(a => a.roleId === cfg.senderId)) continue;

    const roleId = cfg.senderId.toUpperCase().replace(/[^A-Z0-9-]/g, "-");

    const assignment: RoleAssignment = {
      roleId,
      displayName: cfg.displayName,
      roleType: "ai",
      focus: cfg.role || cfg.displayName,
      taskIds: [],
      llm: {
        provider: cfg.provider as any,
        model: cfg.model,
      },
    };

    const prompt: GeneratedPrompt = {
      roleId,
      displayName: cfg.displayName,
      roleType: "ai",
      prompt: cfg.prompt,
      llm: {
        provider: cfg.provider as any,
        model: cfg.model,
      },
    };

    result.assignments.push(assignment);
    result.prompts.push(prompt);
    imported++;
  }

  setLastResult(result);

  return Response.json({
    ok: true,
    imported,
    total: result.assignments.length,
  });
}
