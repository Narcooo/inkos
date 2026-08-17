import { describe, expect, it } from "vitest";
import {
  agentTrajectoryHeaders,
  beginAgentModelCall,
  opaqueConversationId,
  runAsWorkflowTrajectory,
  runWithAgentTrajectory,
  runWithAgentTrajectoryRole,
} from "../llm/agent-trajectory.js";

describe("InkOS agent trajectory metadata", () => {
  it("uses an opaque stable conversation id", () => {
    const first = opaqueConversationId("session-with-user-visible-name");
    expect(first).toBe(opaqueConversationId("session-with-user-visible-name"));
    expect(first).toMatch(/^inkos-[0-9a-f]{32}$/);
    expect(first).not.toContain("user-visible-name");
  });

  it("keeps one run while assigning roles and preserving the parent Pi turn", async () => {
    await runWithAgentTrajectory({
      conversationId: "inkos-conversation",
      runId: "run-1",
      agentRole: "main",
    }, async () => {
      const main = beginAgentModelCall();
      const workflow = await runAsWorkflowTrajectory(async () => beginAgentModelCall());
      const subagent = await runWithAgentTrajectoryRole(
        "subagent",
        async () => beginAgentModelCall(),
        "tool-7",
      );

      const nextMain = beginAgentModelCall();

      expect(main).toMatchObject({ agentRole: "main", runId: "run-1", piTurnIndex: 1 });
      expect(workflow).toMatchObject({ agentRole: "workflow", runId: "run-1", piTurnIndex: 1 });
      expect(subagent).toMatchObject({
        agentRole: "subagent",
        runId: "run-1",
        piTurnIndex: 1,
        parentToolCallId: "tool-7",
      });
      expect(nextMain).toMatchObject({ agentRole: "main", runId: "run-1", piTurnIndex: 2 });
      expect(new Set([
        main?.modelCallId,
        workflow?.modelCallId,
        subagent?.modelCallId,
        nextMain?.modelCallId,
      ]).size).toBe(4);
    });
  });

  it("emits metadata only for kkaiapi endpoints", () => {
    const trace = runWithAgentTrajectory({
      conversationId: "inkos-conversation",
      runId: "run-1",
      agentRole: "main",
    }, () => beginAgentModelCall());

    expect(agentTrajectoryHeaders("https://api.openai.com/v1", trace, 1, { effort: "disabled" })).toEqual({});
    expect(agentTrajectoryHeaders("https://api.kkaiapi.com/v1", trace, 2, {
      effort: "enabled",
      budgetTokens: 4096,
    })).toMatchObject({
      "X-InkOS-Trace-Version": "1",
      "X-InkOS-Scaffold": "pi-inkos",
      "X-InkOS-Conversation-ID": "inkos-conversation",
      "X-InkOS-Run-ID": "run-1",
      "X-InkOS-Agent-Role": "main",
      "X-InkOS-Pi-Turn-Index": "1",
      "X-InkOS-Client-Attempt": "2",
      "X-InkOS-Thinking-Effort": "enabled",
      "X-InkOS-Thinking-Budget-Tokens": "4096",
    });
  });
});
