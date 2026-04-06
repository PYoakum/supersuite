import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ──────────────────────────────────────────────

const REQUEST_TIMEOUT = 30_000;
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

const ACTIONS = [
  "list_repos",
  "get_repo",
  "create_repo",
  "list_branches",
  "list_commits",
  "browse_files",
  "search",
  "list_issues",
  "get_issue",
  "create_issue",
  "update_issue",
  "comment_issue",
  "list_pulls",
  "get_pull",
  "create_pull",
  "update_pull",
  "merge_pull",
  "comment_pull",
  "get_pull_diff",
  "list_pipelines",
  "get_pipeline",
] as const;

type Action = (typeof ACTIONS)[number];

// ── Helpers ────────────────────────────────────────────────

async function gitHostRequest(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
  };

  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  };

  if (body && !["GET", "HEAD"].includes(method)) {
    init.body = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }

  const resp = await fetch(url, init);
  const text = await resp.text();

  if (text.length > MAX_RESPONSE_SIZE) {
    throw new Error(`Response too large: ${text.length} bytes`);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: resp.status, data };
}

function requireArgs(args: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    if (!args[name] && args[name] !== 0) return `${name} is required`;
  }
  return null;
}

function repoPath(args: Record<string, unknown>): string {
  return `/api/repos/${args.owner}/${args.name}`;
}

// ── Action Dispatcher ──────────────────────────────────────

async function dispatch(
  baseUrl: string,
  token: string,
  action: Action,
  args: Record<string, unknown>
): Promise<ToolResult> {
  let err: string | null;

  switch (action) {
    // ── Repositories ──
    case "list_repos": {
      const { status, data } = await gitHostRequest(baseUrl, token, "GET", "/api/repos");
      return formatResponse({ status, data });
    }

    case "get_repo": {
      err = requireArgs(args, "owner", "name");
      if (err) return formatError(err);
      const { status, data } = await gitHostRequest(baseUrl, token, "GET", repoPath(args));
      return formatResponse({ status, data });
    }

    case "create_repo": {
      err = requireArgs(args, "name");
      if (err) return formatError(err);
      const body: Record<string, unknown> = { name: args.name };
      if (args.description) body.description = args.description;
      if (args.isPrivate !== undefined) body.is_private = args.isPrivate;
      const { status, data } = await gitHostRequest(baseUrl, token, "POST", "/api/repos", body);
      return formatResponse({ status, data });
    }

    case "list_branches": {
      err = requireArgs(args, "owner", "name");
      if (err) return formatError(err);
      const { status, data } = await gitHostRequest(baseUrl, token, "GET", `${repoPath(args)}/branches`);
      return formatResponse({ status, data });
    }

    case "list_commits": {
      err = requireArgs(args, "owner", "name");
      if (err) return formatError(err);
      const params = new URLSearchParams();
      if (args.branch) params.set("branch", args.branch as string);
      if (args.limit) params.set("limit", String(args.limit));
      const qs = params.toString();
      const { status, data } = await gitHostRequest(
        baseUrl, token, "GET",
        `${repoPath(args)}/commits${qs ? `?${qs}` : ""}`
      );
      return formatResponse({ status, data });
    }

    case "browse_files": {
      err = requireArgs(args, "owner", "name");
      if (err) return formatError(err);
      const treePath = args.path ? `/${args.path}` : "";
      const params = new URLSearchParams();
      if (args.ref) params.set("ref", args.ref as string);
      const qs = params.toString();
      const { status, data } = await gitHostRequest(
        baseUrl, token, "GET",
        `${repoPath(args)}/tree${treePath}${qs ? `?${qs}` : ""}`
      );
      return formatResponse({ status, data });
    }

    case "search": {
      err = requireArgs(args, "query");
      if (err) return formatError(err);
      const params = new URLSearchParams({ q: args.query as string });
      if (args.limit) params.set("limit", String(args.limit));
      const { status, data } = await gitHostRequest(baseUrl, token, "GET", `/api/search?${params}`);
      return formatResponse({ status, data });
    }

    // ── Issues ──
    case "list_issues": {
      err = requireArgs(args, "owner", "name");
      if (err) return formatError(err);
      const params = new URLSearchParams();
      if (args.state) params.set("status", args.state as string);
      const qs = params.toString();
      const { status, data } = await gitHostRequest(
        baseUrl, token, "GET",
        `${repoPath(args)}/issues${qs ? `?${qs}` : ""}`
      );
      return formatResponse({ status, data });
    }

    case "get_issue": {
      err = requireArgs(args, "owner", "name", "number");
      if (err) return formatError(err);
      const { status, data } = await gitHostRequest(
        baseUrl, token, "GET",
        `${repoPath(args)}/issues/${args.number}`
      );
      return formatResponse({ status, data });
    }

    case "create_issue": {
      err = requireArgs(args, "owner", "name", "title");
      if (err) return formatError(err);
      const body: Record<string, unknown> = { title: args.title };
      if (args.body) body.body = args.body;
      const { status, data } = await gitHostRequest(
        baseUrl, token, "POST",
        `${repoPath(args)}/issues`, body
      );
      return formatResponse({ status, data });
    }

    case "update_issue": {
      err = requireArgs(args, "owner", "name", "number");
      if (err) return formatError(err);
      const body: Record<string, unknown> = {};
      if (args.title) body.title = args.title;
      if (args.body) body.body = args.body;
      if (args.state) body.status = args.state;
      const { status, data } = await gitHostRequest(
        baseUrl, token, "PATCH",
        `${repoPath(args)}/issues/${args.number}`, body
      );
      return formatResponse({ status, data });
    }

    case "comment_issue": {
      err = requireArgs(args, "owner", "name", "number", "body");
      if (err) return formatError(err);
      const { status, data } = await gitHostRequest(
        baseUrl, token, "POST",
        `${repoPath(args)}/issues/${args.number}/comments`,
        { body: args.body }
      );
      return formatResponse({ status, data });
    }

    // ── Pull Requests ──
    case "list_pulls": {
      err = requireArgs(args, "owner", "name");
      if (err) return formatError(err);
      const params = new URLSearchParams();
      if (args.state) params.set("status", args.state as string);
      const qs = params.toString();
      const { status, data } = await gitHostRequest(
        baseUrl, token, "GET",
        `${repoPath(args)}/pulls${qs ? `?${qs}` : ""}`
      );
      return formatResponse({ status, data });
    }

    case "get_pull": {
      err = requireArgs(args, "owner", "name", "number");
      if (err) return formatError(err);
      const { status, data } = await gitHostRequest(
        baseUrl, token, "GET",
        `${repoPath(args)}/pulls/${args.number}`
      );
      return formatResponse({ status, data });
    }

    case "create_pull": {
      err = requireArgs(args, "owner", "name", "title", "head", "base");
      if (err) return formatError(err);
      const body: Record<string, unknown> = {
        title: args.title,
        source_branch: args.head,
        target_branch: args.base,
      };
      if (args.body) body.body = args.body;
      const { status, data } = await gitHostRequest(
        baseUrl, token, "POST",
        `${repoPath(args)}/pulls`, body
      );
      return formatResponse({ status, data });
    }

    case "update_pull": {
      err = requireArgs(args, "owner", "name", "number");
      if (err) return formatError(err);
      const body: Record<string, unknown> = {};
      if (args.title) body.title = args.title;
      if (args.body) body.body = args.body;
      if (args.state) body.status = args.state;
      const { status, data } = await gitHostRequest(
        baseUrl, token, "PATCH",
        `${repoPath(args)}/pulls/${args.number}`, body
      );
      return formatResponse({ status, data });
    }

    case "merge_pull": {
      err = requireArgs(args, "owner", "name", "number");
      if (err) return formatError(err);
      const { status, data } = await gitHostRequest(
        baseUrl, token, "POST",
        `${repoPath(args)}/pulls/${args.number}/merge`
      );
      return formatResponse({ status, data });
    }

    case "comment_pull": {
      err = requireArgs(args, "owner", "name", "number", "body");
      if (err) return formatError(err);
      const { status, data } = await gitHostRequest(
        baseUrl, token, "POST",
        `${repoPath(args)}/pulls/${args.number}/comments`,
        { body: args.body }
      );
      return formatResponse({ status, data });
    }

    case "get_pull_diff": {
      err = requireArgs(args, "owner", "name", "number");
      if (err) return formatError(err);
      const { status, data } = await gitHostRequest(
        baseUrl, token, "GET",
        `${repoPath(args)}/pulls/${args.number}/diff`
      );
      return formatResponse({ status, data });
    }

    // ── Pipelines ──
    case "list_pipelines": {
      err = requireArgs(args, "owner", "name");
      if (err) return formatError(err);
      const { status, data } = await gitHostRequest(
        baseUrl, token, "GET",
        `${repoPath(args)}/pipelines`
      );
      return formatResponse({ status, data });
    }

    case "get_pipeline": {
      err = requireArgs(args, "owner", "name", "runId");
      if (err) return formatError(err);
      const { status, data } = await gitHostRequest(
        baseUrl, token, "GET",
        `${repoPath(args)}/pipelines/${args.runId}`
      );
      return formatResponse({ status, data });
    }

    default:
      return formatError(`Unknown action: ${action}`);
  }
}

// ── Execute ────────────────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const integ = (ctx.config.integrations as any)?.git_host || {};
  const baseUrl = (ctx.config.gitHostUrl as string) || integ.url || "";
  const tokenEnv = (ctx.config.gitHostTokenEnv as string) || integ.token_env || "GIT_HOST_TOKEN";
  const token = process.env[tokenEnv] ?? "";

  if (!baseUrl) return formatError("git-host URL not configured. Set [integrations.git_host] url in agent TOML or gitHostUrl in tools config.");
  if (!token) return formatError(`git-host token not set. Export ${tokenEnv} environment variable.`);

  const action = args.action as Action | undefined;
  if (!action) return formatError("action is required");
  if (!ACTIONS.includes(action)) return formatError(`Unknown action: ${action}. Valid: ${ACTIONS.join(", ")}`);

  try {
    return await dispatch(baseUrl, token, action, args);
  } catch (err: any) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return formatError(`Request timed out after ${REQUEST_TIMEOUT}ms`);
    }
    return formatError(`git-host request failed: ${err.message}`);
  }
}

// ── Tool Definition ────────────────────────────────────────

const gitHostTool: Tool = {
  name: "git_host",
  description:
    "Interact with the git-host API to manage repositories, issues, pull requests, and CI pipelines. " +
    "Requires gitHostUrl and GIT_HOST_TOKEN to be configured.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...ACTIONS],
        description:
          "API action to perform: list_repos, get_repo, create_repo, list_branches, list_commits, " +
          "browse_files, search, list_issues, get_issue, create_issue, update_issue, comment_issue, " +
          "list_pulls, get_pull, create_pull, update_pull, merge_pull, comment_pull, get_pull_diff, " +
          "list_pipelines, get_pipeline",
      },
      owner: { type: "string", description: "Repository owner username" },
      name: { type: "string", description: "Repository name" },
      number: { type: "integer", description: "Issue or pull request number" },
      title: { type: "string", description: "Title for issue or pull request" },
      body: { type: "string", description: "Body/description text or comment content" },
      head: { type: "string", description: "Source branch for pull request" },
      base: { type: "string", description: "Target branch for pull request" },
      state: { type: "string", enum: ["open", "closed", "merged"], description: "Filter by state" },
      path: { type: "string", description: "File path for browsing repo tree" },
      ref: { type: "string", description: "Branch, tag, or commit ref" },
      query: { type: "string", description: "Search query string" },
      runId: { type: "integer", description: "Pipeline run ID" },
      description: { type: "string", description: "Repository description" },
      isPrivate: { type: "boolean", description: "Whether repository is private" },
      branch: { type: "string", description: "Branch name for filtering commits" },
      limit: { type: "integer", description: "Limit number of results" },
    },
    required: ["action"],
  },
  execute,
};

export default gitHostTool;
