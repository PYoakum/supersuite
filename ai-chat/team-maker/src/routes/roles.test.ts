import { describe, test, expect, beforeEach } from "bun:test";
import { setLastResult, getLastResult, handlePatchRoles, handleGetRoles } from "./roles";
import type { EvaluateResponse } from "../core/schema";

function makeResult(): EvaluateResponse {
  return {
    summary: "test",
    tasks: [{ id: "t1", title: "Task 1" }],
    assignments: [
      { roleId: "agent-1", roleType: "ai", focus: "backend", taskIds: ["t1"] },
      { roleId: "human-1", roleType: "human", focus: "review", taskIds: ["t1"] },
    ],
    prompts: [
      { roleId: "agent-1", roleType: "ai", prompt: "You are agent-1..." },
      { roleId: "human-1", roleType: "human", prompt: "You are human-1..." },
    ],
    coverageReport: { coveredTaskIds: ["t1"], uncoveredTaskIds: [], notes: [] },
    ambiguities: [],
  };
}

function jsonReq(body: unknown, method = "PATCH"): Request {
  return new Request("http://localhost/api/roles", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/roles", () => {
  beforeEach(() => setLastResult(null as any));

  test("returns 400 when no evaluation exists", async () => {
    const res = await handleGetRoles(new Request("http://localhost/api/roles"));
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  test("returns assignments and prompts", async () => {
    setLastResult(makeResult());
    const res = await handleGetRoles(new Request("http://localhost/api/roles"));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.assignments).toHaveLength(2);
    expect(data.prompts).toHaveLength(2);
  });
});

describe("PATCH /api/roles", () => {
  beforeEach(() => setLastResult(makeResult()));

  test("patches LLM config on a role", async () => {
    const res = await handlePatchRoles(jsonReq({
      roles: [{
        roleId: "agent-1",
        llm: { provider: "openai", model: "gpt-4o" },
      }],
    }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.applied).toContain("agent-1");
    const agent = data.assignments.find((a: any) => a.roleId === "agent-1");
    expect(agent.llm.provider).toBe("openai");
    expect(agent.llm.model).toBe("gpt-4o");

    // Prompt should also be patched
    const prompt = data.prompts.find((p: any) => p.roleId === "agent-1");
    expect(prompt.llm.provider).toBe("openai");
  });

  test("supports openai-compat with baseUrl", async () => {
    const res = await handlePatchRoles(jsonReq({
      roles: [{
        roleId: "agent-1",
        llm: { provider: "openai-compat", model: "llama-3", baseUrl: "http://localhost:11434" },
      }],
    }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    const agent = data.assignments.find((a: any) => a.roleId === "agent-1");
    expect(agent.llm.baseUrl).toBe("http://localhost:11434");
  });

  test("rejects openai-compat without baseUrl", async () => {
    const res = await handlePatchRoles(jsonReq({
      roles: [{
        roleId: "agent-1",
        llm: { provider: "openai-compat", model: "llama-3" },
      }],
    }));
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  test("rejects unknown role", async () => {
    const res = await handlePatchRoles(jsonReq({
      roles: [{
        roleId: "nonexistent",
        llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      }],
    }));
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  test("rejects invalid provider", async () => {
    const res = await handlePatchRoles(jsonReq({
      roles: [{
        roleId: "agent-1",
        llm: { provider: "fakellm", model: "fake" },
      }],
    }));
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  test("rejects missing model", async () => {
    const res = await handlePatchRoles(jsonReq({
      roles: [{
        roleId: "agent-1",
        llm: { provider: "anthropic", model: "" },
      }],
    }));
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  test("applies multiple roles at once", async () => {
    const res = await handlePatchRoles(jsonReq({
      roles: [
        { roleId: "agent-1", llm: { provider: "openai", model: "gpt-4o" } },
        { roleId: "human-1", llm: { provider: "gemini", model: "gemini-2.5-flash" } },
      ],
    }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.applied).toEqual(["agent-1", "human-1"]);
  });

  test("returns 400 when no evaluation exists", async () => {
    setLastResult(null as any);
    const res = await handlePatchRoles(jsonReq({
      roles: [{ roleId: "agent-1", llm: { provider: "anthropic", model: "test" } }],
    }));
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  test("partial success returns warnings", async () => {
    const res = await handlePatchRoles(jsonReq({
      roles: [
        { roleId: "agent-1", llm: { provider: "openai", model: "gpt-4o" } },
        { roleId: "ghost", llm: { provider: "anthropic", model: "test" } },
      ],
    }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.applied).toContain("agent-1");
    expect(data.warnings).toBeDefined();
    expect(data.warnings.length).toBeGreaterThan(0);
  });
});
