import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createProvider } from "./evaluator";

describe("createProvider API key resolution", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["LLM_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  test("uses ANTHROPIC_API_KEY for anthropic provider", () => {
    process.env.ANTHROPIC_API_KEY = "ant-key";
    const provider = createProvider("anthropic", "test-model");
    expect(provider.name).toBe("anthropic");
  });

  test("uses OPENAI_API_KEY for openai provider", () => {
    process.env.OPENAI_API_KEY = "oai-key";
    const provider = createProvider("openai", "test-model");
    expect(provider.name).toBe("openai");
  });

  test("uses GEMINI_API_KEY for gemini provider", () => {
    process.env.GEMINI_API_KEY = "gem-key";
    const provider = createProvider("gemini", "test-model");
    expect(provider.name).toBe("gemini");
  });

  test("does NOT send anthropic key to openai", () => {
    process.env.ANTHROPIC_API_KEY = "ant-key";
    // openai requested but only ANTHROPIC_API_KEY set — should fail
    expect(() => createProvider("openai", "test-model")).toThrow(/API key not found/);
  });

  test("does NOT send openai key to anthropic", () => {
    process.env.OPENAI_API_KEY = "oai-key";
    expect(() => createProvider("anthropic", "test-model")).toThrow(/API key not found/);
  });

  test("falls back to LLM_API_KEY when provider-specific var missing", () => {
    process.env.LLM_API_KEY = "generic-key";
    const provider = createProvider("openai", "test-model");
    expect(provider.name).toBe("openai");
  });

  test("prefers provider-specific var over LLM_API_KEY", () => {
    process.env.LLM_API_KEY = "generic-key";
    process.env.OPENAI_API_KEY = "oai-key";
    // Should use OPENAI_API_KEY, not LLM_API_KEY
    const provider = createProvider("openai", "test-model");
    expect(provider.name).toBe("openai");
  });

  test("throws when no key is available", () => {
    expect(() => createProvider("anthropic", "test-model")).toThrow(/API key not found/);
  });

  test("error message includes provider-specific var name", () => {
    try {
      createProvider("openai", "test-model");
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toContain("OPENAI_API_KEY");
    }
  });

  test("openai-compat requires baseUrl", () => {
    process.env.LLM_API_KEY = "test-key";
    expect(() => createProvider("openai-compat", "test-model")).toThrow(/baseUrl/);
  });

  test("openai-compat works with baseUrl", () => {
    process.env.LLM_API_KEY = "test-key";
    const provider = createProvider("openai-compat", "test-model", "http://localhost:11434");
    expect(provider.name).toBe("openai-compat");
  });
});
