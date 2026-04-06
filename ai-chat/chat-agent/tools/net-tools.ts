import { spawn } from "child_process";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 300_000;
const MAX_OUTPUT = 10 * 1024 * 1024;
const MAX_PACKETS = 100;
const MAX_HOPS = 128;

// ── Helpers ──────────────────────────────────────────────────

function isHostAllowed(host: string, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) return false;
  if (allowedHosts.includes("*")) return true;
  return allowedHosts.some((allowed) => {
    if (allowed.startsWith("*.")) {
      const domain = allowed.slice(2);
      return host === domain || host.endsWith("." + domain);
    }
    return host === allowed;
  });
}

function runCommand(command: string, args: string[], timeout: number): Promise<{ exitCode: number; stdout: string; stderr: string; duration: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const timeoutId = setTimeout(() => { timedOut = true; proc.kill("SIGKILL"); }, Math.min(timeout, MAX_TIMEOUT));

    proc.stdout.on("data", (data: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += data.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({ exitCode: code ?? (timedOut ? 137 : 1), stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT), duration: Date.now() - startTime, timedOut });
    });
    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({ exitCode: 1, stdout: "", stderr: err.message, duration: Date.now() - startTime, timedOut: false });
    });
  });
}

// ── Parsers ──────────────────────────────────────────────────

function parsePingOutput(output: string) {
  const stats: Record<string, unknown> = { packetsTransmitted: 0, packetsReceived: 0, packetLoss: 100, rttMin: null, rttAvg: null, rttMax: null, rttMdev: null };
  const packetMatch = output.match(/(\d+)\s+packets transmitted,\s+(\d+)\s+(?:packets\s+)?received,\s+([\d.]+)%\s+packet loss/i);
  if (packetMatch) {
    stats.packetsTransmitted = parseInt(packetMatch[1], 10);
    stats.packetsReceived = parseInt(packetMatch[2], 10);
    stats.packetLoss = parseFloat(packetMatch[3]);
  }
  const rttMatch = output.match(/rtt\s+min\/avg\/max\/(?:mdev|stddev)\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/i);
  if (rttMatch) {
    stats.rttMin = parseFloat(rttMatch[1]); stats.rttAvg = parseFloat(rttMatch[2]);
    stats.rttMax = parseFloat(rttMatch[3]); stats.rttMdev = parseFloat(rttMatch[4]);
  }
  return stats;
}

function parseTracerouteOutput(output: string) {
  const hops: Record<string, unknown>[] = [];
  for (const line of output.split("\n")) {
    const hopMatch = line.match(/^\s*(\d+)\s+(.+)/);
    if (!hopMatch) continue;
    const hopNum = parseInt(hopMatch[1], 10);
    const rest = hopMatch[2];

    if (rest.trim() === "* * *") { hops.push({ hop: hopNum, host: null, ip: null, times: [], timeout: true }); continue; }

    const parts = rest.split(/\s+/);
    let host: string | null = null;
    let ip: string | null = null;
    const times: number[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith("(") && part.endsWith(")")) ip = part.slice(1, -1);
      else if (part === "ms") { const t = parseFloat(parts[i - 1]); if (!isNaN(t)) times.push(t); }
      else if (!host && !part.match(/^[\d.]+$/) && part !== "*") host = part;
      else if (!ip && part.match(/^\d+\.\d+\.\d+\.\d+$/)) ip = part;
    }
    hops.push({ hop: hopNum, host: host || ip, ip, times, timeout: false });
  }
  return hops;
}

function parseMtrOutput(output: string) {
  const hops: Record<string, unknown>[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(/^\s*(\d+)\.\|[-─]+\s+(\S+)\s+([\d.]+)%\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (m) {
      hops.push({
        hop: parseInt(m[1], 10), host: m[2] === "???" ? null : m[2],
        loss: parseFloat(m[3]), sent: parseInt(m[4], 10),
        last: parseFloat(m[5]), avg: parseFloat(m[6]), best: parseFloat(m[7]),
        worst: parseFloat(m[8]), stdev: parseFloat(m[9]),
      });
    }
  }
  return hops;
}

// ── Actions ──────────────────────────────────────────────────

async function executePing(args: Record<string, unknown>, allowedHosts: string[]): Promise<ToolResult> {
  const host = args.host as string;
  const count = Math.min((args.count as number) ?? 4, MAX_PACKETS);
  const interval = Math.max(0.2, (args.interval as number) ?? 1);
  const packetSize = Math.min((args.packetSize as number) ?? 56, 65507);
  const ttl = args.ttl as number | undefined;
  const timeout = (args.timeout as number) ?? DEFAULT_TIMEOUT;

  if (!host) return formatError("host is required for ping");
  if (!isHostAllowed(host, allowedHosts)) return formatError(`Host not allowed: ${host}`);

  const pingArgs = ["-c", count.toString(), "-i", interval.toString(), "-s", packetSize.toString()];
  if (ttl) pingArgs.push("-t", Math.min(ttl, MAX_HOPS).toString());
  pingArgs.push(host);

  const result = await runCommand("ping", pingArgs, timeout);
  return formatResponse({
    action: "ping", host, success: result.exitCode === 0, exitCode: result.exitCode,
    statistics: parsePingOutput(result.stdout), rawOutput: result.stdout,
    stderr: result.stderr, duration: result.duration, timedOut: result.timedOut,
  });
}

async function executeTraceroute(args: Record<string, unknown>, allowedHosts: string[]): Promise<ToolResult> {
  const host = args.host as string;
  const maxHops = Math.min((args.maxHops as number) ?? 30, MAX_HOPS);
  const queries = Math.min((args.queries as number) ?? 3, 10);
  const waitTime = Math.min((args.waitTime as number) ?? 5, 10);
  const useIcmp = (args.useIcmp as boolean) ?? false;
  const timeout = (args.timeout as number) ?? DEFAULT_TIMEOUT;

  if (!host) return formatError("host is required for traceroute");
  if (!isHostAllowed(host, allowedHosts)) return formatError(`Host not allowed: ${host}`);

  const trArgs = ["-m", maxHops.toString(), "-q", queries.toString(), "-w", waitTime.toString()];
  if (useIcmp) trArgs.push("-I");
  trArgs.push(host);

  const result = await runCommand("traceroute", trArgs, timeout);
  const hops = parseTracerouteOutput(result.stdout);
  return formatResponse({
    action: "traceroute", host, success: result.exitCode === 0, exitCode: result.exitCode,
    hops, hopCount: hops.length, rawOutput: result.stdout,
    stderr: result.stderr, duration: result.duration, timedOut: result.timedOut,
  });
}

async function executeMtr(args: Record<string, unknown>, allowedHosts: string[]): Promise<ToolResult> {
  const host = args.host as string;
  const count = Math.min((args.count as number) ?? 10, MAX_PACKETS);
  const reportWide = (args.reportWide as boolean) ?? true;
  const useIcmp = (args.useIcmp as boolean) ?? false;
  const noDns = (args.noDns as boolean) ?? false;
  const timeout = (args.timeout as number) ?? DEFAULT_TIMEOUT;

  if (!host) return formatError("host is required for mtr");
  if (!isHostAllowed(host, allowedHosts)) return formatError(`Host not allowed: ${host}`);

  const mtrArgs = ["--report", "-c", count.toString()];
  if (reportWide) mtrArgs.push("--report-wide");
  if (useIcmp) mtrArgs.push("--icmp");
  if (noDns) mtrArgs.push("--no-dns");
  mtrArgs.push(host);

  const result = await runCommand("mtr", mtrArgs, timeout);
  const hops = parseMtrOutput(result.stdout);
  return formatResponse({
    action: "mtr", host, success: result.exitCode === 0, exitCode: result.exitCode,
    hops, hopCount: hops.length, rawOutput: result.stdout,
    stderr: result.stderr, duration: result.duration, timedOut: result.timedOut,
  });
}

// ── Execute Dispatcher ───────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const action = args.action as string;
  const allowedHosts = (ctx.config.netToolsAllowedHosts as string[]) ?? ["*"];

  if (!action) return formatError("action is required (ping, traceroute, mtr)");

  switch (action) {
    case "ping":       return executePing(args, allowedHosts);
    case "traceroute": return executeTraceroute(args, allowedHosts);
    case "mtr":        return executeMtr(args, allowedHosts);
    default:           return formatError(`Unknown action: ${action}. Supported: ping, traceroute, mtr`);
  }
}

// ── Tool Definition ─────────────────────────────────────────

const netToolsTool: Tool = {
  name: "net_tools",
  description:
    "Network diagnostic tools: ping, traceroute, and mtr (My TraceRoute). Use for network troubleshooting, connectivity testing, and route analysis.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["ping", "traceroute", "mtr"], description: "Network action to perform" },
      host: { type: "string", description: "Target hostname or IP address" },
      count: { type: "integer", default: 4, description: "Number of packets/probes to send" },
      interval: { type: "number", default: 1, description: "Interval between pings in seconds" },
      packetSize: { type: "integer", default: 56, description: "Ping packet size in bytes" },
      ttl: { type: "integer", description: "Time-to-live for ping packets" },
      maxHops: { type: "integer", default: 30, description: "Maximum number of hops (traceroute)" },
      queries: { type: "integer", default: 3, description: "Queries per hop (traceroute)" },
      waitTime: { type: "integer", default: 5, description: "Wait time for response in seconds" },
      useIcmp: { type: "boolean", default: false, description: "Use ICMP instead of UDP" },
      reportWide: { type: "boolean", default: true, description: "Wide report format (mtr)" },
      noDns: { type: "boolean", default: false, description: "Skip DNS resolution" },
      timeout: { type: "integer", default: 30000, description: "Operation timeout in milliseconds" },
    },
    required: ["action"],
  },
  execute,
};

export default netToolsTool;
