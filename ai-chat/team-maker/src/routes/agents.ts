import { getLastResult } from "./roles";
import { getSkillsForRole, setSkillsForRole, loadSkillContent } from "./skills";
import { getToolsForRole, getDefaultToolsForKind } from "./tools";
import { config } from "../config";
import { join } from "path";
import { mkdirSync, existsSync, readFileSync } from "fs";
import type { GeneratedPrompt, LLMConfig } from "../core/schema";

const AGENT_DIR = join(import.meta.dir, "..", "..", "agents");
const CHAT_AGENT_DIR = join(import.meta.dir, "..", "..", "..", "chat-agent");
const ENV_FILE = join(import.meta.dir, "..", "..", "..", ".env");

/** Load .env file into a key-value object, merged with process.env */
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (existsSync(ENV_FILE)) {
    const lines = readFileSync(ENV_FILE, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      env[key] = val;
    }
  }
  return env;
}

// Track running agent processes
const runningAgents = new Map<string, { proc: ReturnType<typeof Bun.spawn>; configPath: string }>();

// Track agent token usage (reported by agents via POST /api/agents/stats)
interface AgentStats { inputTokens: number; outputTokens: number; lastReport: string }
const agentStats = new Map<string, AgentStats>();

function escapeTomlString(s: string): string {
  // For TOML basic strings: escape backslashes, quotes, and control chars
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function buildSkillsBlock(roleId: string): string {
  const skillFiles = getSkillsForRole(roleId);
  if (skillFiles.length === 0) return "";

  let block = "\\n\\nYOUR SKILLS:\\nThe following reference materials define your specialized capabilities. Use them actively.\\n";
  for (const filename of skillFiles) {
    const content = loadSkillContent(filename);
    if (!content) continue;
    const escaped = content.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
    block += `\\n--- ${filename} ---\\n${escaped}\\n--- end ---\\n`;
  }
  return block;
}

function buildWorkerPreamble(name: string, pmName: string): string {
  return `You are ${name} in a live multi-agent chat room. You collaborate with other AI agents and humans in real time.\\n\\nHUMAN PRIORITY (MOST IMPORTANT RULE):\\n- When a human sends a message, ALWAYS respond to it directly. Human messages take absolute priority over everything else.\\n- If a human gives you an instruction, follow it immediately — even if it contradicts your current task.\\n- If a human asks a question, answer it first before doing anything else.\\n- Address the human by name when responding to them.\\n\\nHONESTY (CRITICAL):\\n- NEVER fabricate facts, claim actions you did not take, or invent human reactions that did not happen.\\n- NEVER claim a human \\"seemed pleased\\", \\"approved\\", or \\"liked\\" something unless they explicitly said so in the chat.\\n- If you are uncertain about something, say so. Speculation must be clearly labeled as such.\\n- If you made a mistake, admit it immediately rather than covering it up.\\n- Your PM monitors for dishonesty. Fabrications will be flagged and reported to human supervisors.\\n\\nCHAT RULES:\\n- Keep messages SHORT (2-4 paragraphs max)\\n- Share incremental progress, not finished documents\\n- If a human asks you to wait or hold, stop responding until addressed again\\n\\nSESSION RULES:\\n- NEVER say \\"session:end\\" unless a human explicitly tells you to stop\\n- Completing tasks does NOT end your session — stay active and available\\n\\nMODERATION:\\n- Your PM (${pmName}) moderates the chat. Obey their instructions.\\n- If you see [MUTE] with your name, stop responding until [UNMUTE].\\n\\nTASK STATUS:\\nReport progress to ${pmName} in plain language. Do NOT use [TASK:...] tags.\\n\\nYour assignment:\\n`;
}

function buildRecruiterPreamble(name: string): string {
  return `You are ${name}, a Recruiter agent responsible for assembling and managing teams of AI agents.\\n\\nMINIMIZE CHAT (CRITICAL):\\n- Only send messages when ABSOLUTELY NECESSARY: announcing team changes, responding to humans, or reporting critical issues.\\n- NEVER engage in social conversation, encouragement, or acknowledgements.\\n- If you have nothing actionable to communicate, stay silent.\\n\\nHUMAN PRIORITY:\\n- When a human sends a message, respond immediately. Human messages override everything.\\n- Address the human by name.\\n\\nHONESTY:\\n- Never fabricate facts or invent human reactions.\\n- Report actual data from tools, not estimates or guesses.\\n\\nTEAM MANAGEMENT WORKFLOW:\\n1. Assess tasks — use team_status and read_chat_logs to understand what work needs doing.\\n2. Recruit — use recruit_agent to hire agents with appropriate skills for unfilled roles. Check team size cap first.\\n3. Monitor — use team_status periodically to track token usage and agent activity.\\n4. Dismiss — when an agent\\'s work is complete, use dismiss_agent to stop them and post a work summary.\\n5. Track tokens — use update_task_tokens to record token spend per task after agent dismissal.\\n\\nGUARDRAILS:\\n- Maximum team size: ${config.maxTeamSize} agents. Always check before recruiting.\\n- Project token budget: ${config.projectTokenBudget.toLocaleString()} tokens. Monitor with team_status. When approaching 80%, begin dismissing agents whose work is complete.\\n- When the project token budget is exhausted, dismiss ALL remaining agents with work summaries.\\n- Per-task token budgets: set via update_task_tokens. Flag tasks that exceed their budget.\\n\\nDISMISSAL PROTOCOL:\\n- ALWAYS post a work summary before stopping an agent.\\n- Summary must include: messages sent, tokens consumed, tasks worked on, key outputs.\\n- Update task token totals after dismissal.\\n\\nSESSION RULES:\\n- NEVER say \\"session:end\\" unless a human explicitly tells you to stop.\\n- You are the last agent to leave — dismiss all workers and PMs first.\\n\\nYour assignment:\\n`;
}

function buildPMPreamble(name: string): string {
  return `You are ${name} in a live multi-agent chat room. You are a Project Manager overseeing AI workers.\\n\\nHUMAN PRIORITY (MOST IMPORTANT RULE):\\n- When a human sends a message, ALWAYS respond to it directly and immediately. Human messages take absolute priority.\\n- If a human gives an instruction, act on it right away — relay it to your workers, update tasks, or answer their question.\\n- If a human asks for a status report, provide one immediately.\\n- Address the human by name when responding.\\n- Never ignore a human message. Even if you are busy, acknowledge it.\\n\\nCHAT RULES:\\n- Keep messages SHORT (2-4 paragraphs max)\\n- Ask targeted questions to your workers\\n- Summarize progress concisely\\n\\nSESSION RULES:\\n- NEVER say \\"session:end\\" unless a human explicitly tells you to stop\\n- Stay active after tasks complete — report final status and wait\\n\\nTASK MANAGEMENT:\\nYou update the task board. Workers report to you. Use these tags when appropriate:\\n- [TASK:Tx:in-progress] — started\\n- [TASK:Tx:done] — completed (verify first)\\n- [TASK:Tx:blocked] — blocked\\n\\nHONESTY MONITORING (CRITICAL):\\n- You are responsible for monitoring your workers for dishonesty.\\n- Watch for: fabricated facts, claims of human approval that never happened, invented results, exaggerated progress, or false attributions.\\n- Example violations: \\"the supervisor seemed pleased\\" (when the supervisor never responded), \\"tests all passed\\" (when no tests were run), \\"the human approved\\" (when no human message exists).\\n- When you detect a likely fabrication, use the flag_agent tool IMMEDIATELY to alert human supervisors.\\n- Include: the agent name, the specific dishonest claim, and what actually happened (or didn't).\\n- Do not accuse agents of dishonesty in regular chat — use the flag tool so it stands out visually.\\n- You must also follow all honesty rules yourself. Never fabricate facts or invent human reactions.\\n\\nMODERATION:\\n- Keep agents focused. Redirect off-topic agents.\\n- Use chat_participation ONLY when you see a specific problem or a human asks. Do NOT poll it routinely.\\n- Mute agents only when they are clearly derailing progress.\\n\\nEFFICIENCY:\\n- Each message costs tokens. Batch instructions. Stay quiet when things are smooth.\\n- Don't request unnecessary revisions. Move on when work is done.\\n\\nYour PM duties:\\n`;
}

function buildToml(prompt: GeneratedPrompt, preambleOverride?: string): string {
  const name = prompt.displayName || prompt.roleId;
  const id = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const llm = prompt.llm || {} as Partial<LLMConfig>;
  const provider = llm.provider || config.defaultProvider;
  const model = llm.model || config.defaultModel;
  const apiKeyEnv = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
    "openai-compat": "OPENAI_API_KEY",
  }[provider] || "LLM_API_KEY";

  const wsUrl = config.chatServerUrl.replace(/^http/, "ws") + "/ws";
  const roleKind = prompt.roleKind || "worker";

  // Resolve tool allowlist: explicit assignment > prompt.tools > role defaults
  const explicitTools = getToolsForRole(prompt.roleId);
  const toolAllowed = explicitTools.length > 0
    ? explicitTools
    : prompt.tools && prompt.tools.length > 0
      ? prompt.tools
      : getDefaultToolsForKind(roleKind);

  // Build role-appropriate preamble
  const effectiveKind = preambleOverride || roleKind;
  let preamble: string;
  if (effectiveKind === "recruiter") {
    preamble = buildRecruiterPreamble(name);
  } else if (effectiveKind === "pm") {
    preamble = buildPMPreamble(name);
  } else {
    // Find PM name for this worker
    const lastResult = getLastResult();
    const assignment = lastResult?.assignments.find((a) => a.roleId === prompt.roleId);
    const pmAssignment = lastResult?.assignments.find((a) => a.roleId === assignment?.managedBy);
    const pmName = pmAssignment?.displayName || pmAssignment?.roleId || "your PM";
    preamble = buildWorkerPreamble(name, pmName);
  }

  const skillsBlock = buildSkillsBlock(prompt.roleId);
  const escapedPrompt = escapeTomlString(preamble + prompt.prompt + skillsBlock);
  const roleTag = roleKind === "pm" ? "pm" : "worker";

  return `[identity]
sender_id = "${id}"
display_name = "${name}"
avatar = "${prompt.avatar || ""}"
role = "team-maker-${roleTag}"
sender_type = "agent"
channel = "general"
tags = ["team-maker", "${prompt.roleId}", "${prompt.roleType}", "${roleTag}"]

[server]
url = "${wsUrl}"
api_url = "${config.chatServerUrl}"
team_maker_url = "http://localhost:${config.port}"
bootstrap_history = 10

[llm]
provider = "${provider}"
model = "${model}"
api_key_env = "${apiKeyEnv}"
${llm.baseUrl ? `base_url = "${llm.baseUrl}"` : `base_url = ""`}
max_tokens = 2048
temperature = 0.5

[prompt]
template = "${escapedPrompt}"

[context]
max_messages = 20
max_chars = 8000
include_own_messages = true

[limits.rate]
min_delay_ms = 3000
max_per_minute = 10
max_message_chars = 1500

[limits.spend]
max_input_tokens = 5000000
max_output_tokens = 500000

[limits.messages]
max_sent = 10000
max_received = 10000

[limits.session]
max_duration_minutes = 1440
max_total_messages = 20000
end_keywords = ["session:end"]
send_farewell = true
farewell_message = "Signing off."

[tools]
enabled = true
allowed = [${toolAllowed.length > 0 ? toolAllowed.map(t => `"${t}"`).join(", ") : ""}]
denied = []
sandbox_dir = "./sandbox"
max_tool_rounds = 5
announce_tool_use = false

[reasoning.thinking]
provider = ""
model = ""
api_key_env = ""
max_tokens = 4096
temperature = 0.3

[reasoning.analyzing]
provider = ""
model = ""
api_key_env = ""
max_tokens = 4096
temperature = 0.2

[reasoning.reviewing_work]
provider = ""
model = ""
api_key_env = ""
max_tokens = 4096
temperature = 0.2
`;
}

export async function handleLaunchAgent(req: Request): Promise<Response> {
  const lastResult = getLastResult();
  if (!lastResult) {
    return Response.json(
      { ok: false, errors: ["No evaluation result — run an evaluation or import first"] },
      { status: 400 },
    );
  }

  let body: { roleId: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON body"] }, { status: 400 });
  }

  if (!body.roleId) {
    return Response.json({ ok: false, errors: ["roleId is required"] }, { status: 400 });
  }

  const prompt = lastResult.prompts.find(p => p.roleId === body.roleId);
  if (!prompt) {
    return Response.json(
      { ok: false, errors: [`Role ${body.roleId} not found in evaluation`] },
      { status: 400 },
    );
  }

  if (prompt.roleType !== "ai") {
    return Response.json(
      { ok: false, errors: [`${body.roleId} is a human role, not launchable as an agent`] },
      { status: 400 },
    );
  }

  if (runningAgents.has(body.roleId)) {
    return Response.json({ ok: true, roleId: body.roleId, alreadyRunning: true });
  }

  // Write TOML config
  if (!existsSync(AGENT_DIR)) mkdirSync(AGENT_DIR, { recursive: true });
  const name = prompt.displayName || prompt.roleId;
  const configPath = join(AGENT_DIR, `${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.toml`);
  await Bun.write(configPath, buildToml(prompt));

  // Spawn chat-agent process with env vars passed explicitly
  const proc = Bun.spawn(
    ["bun", "run", "src/index.ts", "--config", configPath],
    {
      cwd: CHAT_AGENT_DIR,
      env: loadEnv(),
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  runningAgents.set(body.roleId, { proc, configPath });

  // Monitor for unexpected exit
  const roleId = body.roleId;
  proc.exited.then((code) => {
    if (runningAgents.has(roleId)) {
      console.log(`[agents] ${roleId} exited with code ${code}`);
      runningAgents.delete(roleId);
    }
  });

  // Wait for agent to connect, then nudge it to introduce itself
  const assignment = getLastResult()?.assignments.find(a => a.roleId === body.roleId);
  const isPM = assignment?.roleKind === "pm";
  const taskSummary = assignment
    ? isPM
      ? `Managing workers: ${assignment.manages?.join(", ") || "none"}. Tasks: ${assignment.taskIds.join(", ")}`
      : `Your tasks: ${assignment.taskIds.join(", ")}. Focus: ${assignment.focus}`
    : "";

  const nudge = isPM
    ? `${name} has joined as a Project Manager. ${taskSummary}\n\n${name}, introduce yourself to your team and begin coordinating their work.`
    : `${name} has joined the team. ${taskSummary}\n\n${name}, please introduce yourself and begin working on your tasks. Report progress to your PM.`;

  setTimeout(async () => {
    try {
      await fetch(`${config.chatServerUrl}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderType: "system",
          senderId: "team-maker",
          displayName: "Team Maker",
          role: "coordinator",
          content: nudge,
          tags: ["team-maker", "nudge", body.roleId],
          channel: "general",
        }),
      });
    } catch {}
  }, 8000);

  return Response.json({
    ok: true,
    roleId: body.roleId,
    displayName: name,
    pid: proc.pid,
    config: configPath,
  });
}

export async function handleStopAgent(req: Request): Promise<Response> {
  let body: { roleId: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON body"] }, { status: 400 });
  }

  if (!body.roleId) {
    return Response.json({ ok: false, errors: ["roleId is required"] }, { status: 400 });
  }

  const agent = runningAgents.get(body.roleId);
  if (!agent) {
    return Response.json({ ok: true, roleId: body.roleId, stopped: false, reason: "not running" });
  }

  agent.proc.kill();
  runningAgents.delete(body.roleId);

  return Response.json({ ok: true, roleId: body.roleId, stopped: true });
}

export function handleListAgents(): Response {
  // Clean up exited processes
  for (const [roleId, a] of runningAgents) {
    if (a.proc.exitCode !== null) {
      runningAgents.delete(roleId);
    }
  }

  const agents = Array.from(runningAgents.entries()).map(([roleId, a]) => ({
    roleId,
    pid: a.proc.pid,
    exitCode: a.proc.exitCode,
    running: a.proc.exitCode === null,
    config: a.configPath,
  }));

  return Response.json({ ok: true, agents });
}

// ── Stats endpoints ──────────────────────────────────────────

export async function handleReportStats(req: Request): Promise<Response> {
  let body: { agentId: string; inputTokens: number; outputTokens: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON"] }, { status: 400 });
  }
  if (!body.agentId) {
    return Response.json({ ok: false, errors: ["agentId required"] }, { status: 400 });
  }

  agentStats.set(body.agentId, {
    inputTokens: body.inputTokens || 0,
    outputTokens: body.outputTokens || 0,
    lastReport: new Date().toISOString(),
  });

  return Response.json({ ok: true });
}

export function handleGetStats(): Response {
  // Clean up stats for agents that are no longer running
  const runningIds = new Set(
    Array.from(runningAgents.keys()).map(id => {
      const a = runningAgents.get(id);
      if (!a || a.proc.exitCode !== null) return null;
      // Match by roleId or sender_id (kebab-case of display name)
      return id;
    }).filter(Boolean)
  );

  const stats: Record<string, AgentStats> = {};
  let totalInput = 0;
  let totalOutput = 0;

  for (const [agentId, s] of agentStats) {
    stats[agentId] = s;
    totalInput += s.inputTokens;
    totalOutput += s.outputTokens;
  }

  return Response.json({
    ok: true,
    stats,
    totals: { inputTokens: totalInput, outputTokens: totalOutput },
    projectBudget: config.projectTokenBudget,
    budgetRemaining: Math.max(0, config.projectTokenBudget - totalInput - totalOutput),
  });
}

// ── Recruit endpoint (no evaluation required) ────────────────

interface RecruitRequest {
  name: string;
  role: string;
  focus: string;
  preambleType?: "worker" | "pm" | "recruiter";
  provider?: string;
  model?: string;
  tools?: string[];
  skills?: string[];
}

export async function handleRecruitAgent(req: Request): Promise<Response> {
  let body: RecruitRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON"] }, { status: 400 });
  }

  if (!body.name || !body.role) {
    return Response.json({ ok: false, errors: ["name and role are required"] }, { status: 400 });
  }

  // Enforce team size cap
  const running = Array.from(runningAgents.values()).filter(a => a.proc.exitCode === null);
  if (running.length >= config.maxTeamSize) {
    return Response.json({
      ok: false,
      errors: [`Team size cap reached (${running.length}/${config.maxTeamSize}). Dismiss agents before recruiting.`],
    }, { status: 400 });
  }

  const id = body.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (runningAgents.has(id)) {
    return Response.json({ ok: true, roleId: id, alreadyRunning: true });
  }

  // Build a synthetic GeneratedPrompt for buildToml
  const preambleType = body.preambleType || "worker";
  const prompt: GeneratedPrompt = {
    roleId: id,
    displayName: body.name,
    roleType: "ai",
    roleKind: preambleType === "recruiter" ? "worker" : preambleType,
    prompt: body.focus,
    tools: body.tools || getDefaultToolsForKind(preambleType === "recruiter" ? "recruiter" : preambleType),
    skills: body.skills,
    llm: {
      provider: (body.provider || config.defaultProvider) as any,
      model: body.model || config.defaultModel,
    },
  };

  // Register skills so buildSkillsBlock() can find them
  if (body.skills && body.skills.length > 0) {
    setSkillsForRole(id, body.skills);
  }

  // Override preamble for recruiter type
  const toml = buildToml(prompt, preambleType === "recruiter" ? "recruiter" : undefined);

  if (!existsSync(AGENT_DIR)) mkdirSync(AGENT_DIR, { recursive: true });
  const configPath = join(AGENT_DIR, `${id}.toml`);
  await Bun.write(configPath, toml);

  const proc = Bun.spawn(
    ["bun", "run", "src/index.ts", "--config", configPath],
    { cwd: CHAT_AGENT_DIR, env: loadEnv(), stdout: "inherit", stderr: "inherit" },
  );

  runningAgents.set(id, { proc, configPath });

  proc.exited.then((code) => {
    if (runningAgents.has(id)) {
      console.log(`[agents] ${id} exited with code ${code}`);
      runningAgents.delete(id);
    }
  });

  // Nudge
  setTimeout(async () => {
    try {
      await fetch(`${config.chatServerUrl}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderType: "system",
          senderId: "team-maker",
          displayName: "Team Maker",
          role: "coordinator",
          content: `${body.name} has been recruited as ${body.role}. Focus: ${body.focus}.\n\n${body.name}, begin working on your assignment.`,
          tags: ["team-maker", "nudge", "recruited", id],
          channel: "general",
        }),
      });
    } catch {}
  }, 8000);

  return Response.json({ ok: true, roleId: id, displayName: body.name, pid: proc.pid, config: configPath });
}

// Cleanup on process exit
process.on("beforeExit", () => {
  for (const [, agent] of runningAgents) {
    agent.proc.kill();
  }
});
