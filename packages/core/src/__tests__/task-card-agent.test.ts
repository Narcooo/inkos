import { describe, it, expect, vi } from "vitest";
import { TaskCardAgent } from "../agents/task-card-agent.js";

describe("task-card-agent", () => {
  const mockContext: any = {
    client: {} as any,
    model: "test-model",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  const mockTaskCard = {
    chapter_goal: "Test Goal",
    active_lines: ["Line A"],
    core_pressure: "High",
    forbidden_moves: ["No Drift"],
    hook_type: "Mystery",
  };

  it("should parse task card from LLM response with code fence", async () => {
    const agent = new TaskCardAgent(mockContext);
    vi.spyOn(agent as any, "chat").mockResolvedValue({
      content: "```json\n{\"chapter_goal\": \"Test\", \"active_lines\": [], \"core_pressure\": \"\", \"forbidden_moves\": [], \"hook_type\": \"\"}\n```",
    });

    const card = await agent.generateTaskCard("Outline", "Anchor", 1, "", "zh");

    expect(card.chapterGoal).toBe("Test");
  });

  it("should handle raw JSON without code fence", async () => {
    const agent = new TaskCardAgent(mockContext);
    vi.spyOn(agent as any, "chat").mockResolvedValue({
      content: "{\"chapter_goal\": \"Raw\", \"active_lines\": [], \"core_pressure\": \"\", \"forbidden_moves\": [], \"hook_type\": \"\"}",
    });

    const card = await agent.generateTaskCard("Outline", "Anchor", 1, "", "zh");
    expect(card.chapterGoal).toBe("Raw");
  });

  it("should fallback to default card on parse error", async () => {
    const agent = new TaskCardAgent(mockContext);
    vi.spyOn(agent as any, "chat").mockResolvedValue({
      content: "Invalid JSON",
    });

    const card = await agent.generateTaskCard("Outline", "Anchor", 1, "", "zh");
    expect(card.chapterGoal).toContain("推进当前主线"); // fallback default zh
  });

  it("should generate a valid task card with hooks awareness", async () => {
    const agent = new TaskCardAgent(mockContext);
    vi.spyOn(agent as any, "chat").mockResolvedValue({
      content: JSON.stringify(mockTaskCard)
    });

    const card = await agent.generateTaskCard("Outline", "Anchor", 5, "| H01 | 4 | open | Hook |", "en");
    expect(card.chapterGoal).toBe("Test Goal");
  });
});
