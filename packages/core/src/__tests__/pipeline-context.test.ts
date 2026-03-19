import { describe, it, expect, vi, beforeEach } from "vitest";
import { PipelineContext, type PipelineContextConfig } from "../pipeline/pipeline-context.js";
import type { LLMClient } from "../llm/provider.js";

function stubClient(tag = "default"): LLMClient {
  return { _tag: tag } as unknown as LLMClient;
}

function baseConfig(overrides?: Partial<PipelineContextConfig>): PipelineContextConfig {
  return {
    client: stubClient(),
    model: "base-model",
    projectRoot: "/tmp/test",
    ...overrides,
  };
}

describe("PipelineContext", () => {
  describe("resolveOverride", () => {
    it("returns base client/model when no overrides exist", () => {
      const config = baseConfig();
      const pctx = new PipelineContext(config);
      const result = pctx.resolveOverride("writer");
      expect(result.model).toBe("base-model");
      expect(result.client).toBe(config.client);
    });

    it("handles string override (model only)", () => {
      const client = stubClient();
      const pctx = new PipelineContext(baseConfig({
        client,
        modelOverrides: { writer: "gpt-4o" },
      }));
      const result = pctx.resolveOverride("writer");
      expect(result.model).toBe("gpt-4o");
      expect(result.client).toBe(client);
    });

    it("handles object override without baseUrl", () => {
      const client = stubClient();
      const pctx = new PipelineContext(baseConfig({
        client,
        modelOverrides: { writer: { model: "claude-4", baseUrl: "" } },
      }));
      const result = pctx.resolveOverride("writer");
      expect(result.model).toBe("claude-4");
      expect(result.client).toBe(client);
    });

    it("returns base for agents without override", () => {
      const pctx = new PipelineContext(baseConfig({
        modelOverrides: { writer: "gpt-4o" },
      }));
      const result = pctx.resolveOverride("auditor");
      expect(result.model).toBe("base-model");
    });
  });

  describe("agentCtxFor", () => {
    it("returns correct AgentContext fields", () => {
      const pctx = new PipelineContext(baseConfig());
      const ctx = pctx.agentCtxFor("writer", "book-1");
      expect(ctx.model).toBe("base-model");
      expect(ctx.projectRoot).toBe("/tmp/test");
      expect(ctx.bookId).toBe("book-1");
    });

    it("passes undefined bookId when not provided", () => {
      const pctx = new PipelineContext(baseConfig());
      const ctx = pctx.agentCtxFor("radar");
      expect(ctx.bookId).toBeUndefined();
    });
  });

  describe("agentCtx", () => {
    it("returns base context without override", () => {
      const pctx = new PipelineContext(baseConfig());
      const ctx = pctx.agentCtx("book-2");
      expect(ctx.model).toBe("base-model");
      expect(ctx.bookId).toBe("book-2");
    });
  });
});
