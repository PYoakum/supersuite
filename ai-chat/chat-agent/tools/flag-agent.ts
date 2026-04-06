import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const agentName = args.agent_name as string | undefined;
  const claim = args.claim as string | undefined;
  const evidence = args.evidence as string | undefined;
  const chatServerUrl = ctx.config.chatServerUrl as string;
  const pmId = ctx.config.agentId as string;
  const pmName = ctx.config.agentName as string;
  const channel = (ctx.config.agentChannel as string) || "general";

  if (!chatServerUrl) return formatError("chatServerUrl not configured");
  if (!agentName) return formatError("agent_name is required");
  if (!claim) return formatError("claim is required — what did the agent say that was dishonest?");

  const content = [
    `DISHONESTY FLAG: ${agentName}`,
    `Claim: "${claim}"`,
    evidence ? `Evidence: ${evidence}` : "Evidence: No supporting message found in chat history.",
    `Flagged by: ${pmName}`,
  ].join("\n");

  const res = await fetch(`${chatServerUrl}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      senderType: "system",
      senderId: pmId,
      displayName: pmName,
      content,
      contentFormat: "flag",
      channel,
      tags: ["flag", "dishonesty", agentName.toLowerCase().replace(/\s+/g, "-")],
    }),
  });

  const data = await res.json() as any;
  if (!data.ok) {
    return formatError(`Failed to post flag: ${data.errors?.join(", ") || "unknown"}`);
  }

  return formatResponse({ flagged: true, agent: agentName, messageId: data.message?.id });
}

const flagAgentTool: Tool = {
  name: "flag_agent",
  description:
    "Flag an agent for suspected dishonesty. Posts a highly visible alert in the chat for human supervisors. " +
    "Use when a worker fabricates facts, claims human approval that never happened, invents results, " +
    "or makes false attributions. Include the specific dishonest claim and what actually happened.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      agent_name: { type: "string", description: "Display name of the agent being flagged" },
      claim: { type: "string", description: "The specific dishonest statement or claim" },
      evidence: { type: "string", description: "What actually happened (or didn't) — cite chat messages if possible" },
    },
    required: ["agent_name", "claim"],
  },
  execute,
};

export default flagAgentTool;
