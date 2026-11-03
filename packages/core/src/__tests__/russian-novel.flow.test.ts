import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createBookFoundationTool } from "../harness/tools/longform-production.js";
import { createLLMClient } from "../llm/provider.js";
import { PipelineRunner } from "../pipeline/runner.js";
import { StateManager } from "../state/manager.js";
import { loadRuntimeStateSnapshot } from "../state/runtime-state-store.js";
import { inferLanguage } from "../utils/language.js";
import { buildLengthSpec, countChapterLength, resolveLengthCountingMode } from "../utils/length-metrics.js";
import { splitChapters } from "../utils/chapter-splitter.js";

const fetchWithProxy = vi.hoisted(() => vi.fn());
vi.mock("../utils/proxy-fetch.js", () => ({ fetchWithProxy }));

const original = "Анна открыла окно и увидела, что поезд уже ушёл.";
const revised = original.replace("открыла окно", "приоткрыла окно");
const title = "Последний поезд";
const nextChapter = "На платформе Анна увидела сторожа и показала ему письмо.";

it("recognizes the issue #416 sentence and counts Russian prose in its native unit", () => {
  expect(inferLanguage(original)).toBe("ru");
  expect(inferLanguage("В вагоне Анна заметила табличку Exit.")).toBe("ru");
  expect(inferLanguage("The train left. Анна waved.")).toBe("en");
  expect(inferLanguage("她到站时，火车已经开走了。")).toBe("zh");
  expect(inferLanguage()).toBe("zh");
  expect(countChapterLength(original, resolveLengthCountingMode("ru"))).toBe(9);
  expect(countChapterLength("# Глава 1: Заголовок\n\n— Всё-таки по-русски, Ёж? — спросил Jack.\n\n~~~\nЭтот блок пропускается.\n~~~", "ru_words")).toBe(5);
  expect(countChapterLength("He can't go.", "en_words")).toBe(3);
  expect(countChapterLength("他到了。", "zh_chars")).toBe(4);
  expect(buildLengthSpec(2000, "ru")).toEqual({ target: 2000, countingMode: "ru_words" });
  expect(splitChapters(`## ГЛАВА I — Окно\n\n${original}\n\nГлава 2\n\nАнна ушла.`)).toEqual([
    { title: "Окно", content: original },
    { title: "Глава 2", content: "Анна ушла." },
  ]);
});

it("creates, writes, reviews and edits a Russian novel with continuity and length checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkos-ru-"));
  const requests = new Map<string, string[]>();
  const hookId = "station-letter";
  const responses: Record<string, object> = {
    submit_foundation_outline: {
      storyFrame: "Анна опоздала на последний поезд и должна передать письмо.",
      volumeMap: "Анна видит, что поезд ушёл. Позднее она ищет адресата.",
    },
    submit_foundation_details: {
      bookRules: "Письмо остаётся запечатанным.",
      bookRulesData: { prohibitions: [], enableFullCastTracking: false, allowedDeviations: [] },
      pendingHooks: [{ hookId, type: "загадка", expectedPayoff: "Кому адресовано письмо?", notes: "Письмо запечатано." }],
    },
    submit_foundation_cast_index: { roles: [{ name: "Анна", tier: "major" }] },
    submit_foundation_cast_documents: { role_1_content: "Анна везёт письмо и не знает, кому оно адресовано." },
    submit_selected_sources: { selectedIndices: [1] },
    submit_chapter_memo: { goal: "Анна замечает, что поезд ушёл.", body: "Сначала Анна открывает окно, затем видит пустой путь.", threadRefs: [] },
    submit_chapter_draft: { title, content: `# Глава 1: ${title}\n\n${original}` },
    submit_runtime_state_delta: {
      postSettlement: "Анна осталась на станции.",
      factOps: { upsert: [{ subject: "Анна", predicate: "местонахождение", object: "станция" }], expire: [] },
      hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
      newHookCandidates: [],
      chapterSummary: { title, characters: "Анна", events: "Поезд ушёл.", stateChanges: "Анна осталась на станции.", hookActivity: "", mood: "тревога", chapterType: "завязка" },
    },
    submit_chapter_review: { summary: "Хронология соблюдена.", observations: [] },
    submit_state_validation: { reconciliationRequired: false, reportMarkdown: "" },
    submit_chapter_range_replacements: { range_0_content: "приоткрыла окно" },
  };
  fetchWithProxy.mockImplementation(async (_url: string, init: RequestInit) => {
    const { tools, messages } = JSON.parse(String(init.body)) as {
      tools: Array<{ function: { name: string } }>;
      messages: Array<{ content: string }>;
    };
    const name = tools[0]!.function.name;
    const history = requests.get(name) ?? [];
    history.push(messages.map((message) => message.content).join("\n"));
    requests.set(name, history);
    let args = responses[name];
    if (name === "submit_chapter_range_replacements" && history.length === 1) {
      args = { range_0_content: "резко распахнула окно" };
    }
    if (name === "submit_chapter_draft" && history.length === 2) {
      args = { title: "Сторож", content: nextChapter };
    }
    if (!args) {
      throw new Error(`Unexpected tool: ${name}`);
    }
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{
        id: `${name}-${history.length}`, type: "function", function: { name, arguments: JSON.stringify(args) },
      }] } }],
    }));
  });

  try {
    const client = createLLMClient({
      provider: "openai", service: "custom", configSource: "studio", model: "fixture",
      apiKey: "fixture", baseUrl: "https://example.test/v1", apiFormat: "chat", stream: false,
      temperature: 0, thinkingBudget: 0,
    });
    const pipeline = new PipelineRunner({ projectRoot: root, model: "fixture", client });
    const state = new StateManager(root);
    const bookId = "последний-поезд";
    await createBookFoundationTool(pipeline).execute("create-russian", {
      title, instruction: "Анна опаздывает на поезд с запечатанным письмом.",
      chapterWordCount: 9, minChapterLength: 9, maxChapterLength: 9,
    });
    const bookDir = state.bookDir(bookId);
    expect(await state.loadBookConfig(bookId)).toMatchObject({ language: "ru", chapterWordCount: 9 });

    const written = await pipeline.writeNextChapter(bookId);
    expect(written).toMatchObject({ wordCount: 9, delivery: { status: "checks_passed" } });
    expect(written.review.summary).toBe("Хронология соблюдена.");
    const chapterPath = join(bookDir, "chapters", "0001_Последний_поезд.md");
    expect(await readFile(chapterPath, "utf8")).toBe(`# Глава 1: ${title}\n\n${original}`);

    const result = await pipeline.reviseDraft(
      bookId, 1, "spot-fix", "Уточните, что окно открыто чуть-чуть.", { targetText: "открыла окно" },
    );
    expect(result).toMatchObject({ changed: true, wordCount: 9, delivery: { status: "checks_passed" } });
    expect(await readFile(chapterPath, "utf8")).toBe(`# Глава 1: ${title}\n\n${revised}`);
    expect((await state.loadChapterIndex(bookId))[0]).toMatchObject({
      provenance: "edited", wordCount: 9, lengthTelemetry: { countingMode: "ru_words", finalCount: 9 },
    });
    const snapshot = await loadRuntimeStateSnapshot(bookDir);
    expect(snapshot.manifest).toMatchObject({ language: "ru", lastAppliedChapter: 1 });
    expect(snapshot.currentState.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "Анна", predicate: "местонахождение", object: "станция" }),
    ]));
    expect(snapshot.chapterSummaries.rows[0]?.events).toBe("Поезд ушёл.");
    expect(snapshot.hooks.hooks[0]).toMatchObject({ hookId, status: "deferred" });

    for (const name of [
      "submit_foundation_outline", "submit_foundation_details", "submit_foundation_cast_index",
      "submit_foundation_cast_documents", "submit_chapter_memo", "submit_chapter_draft",
      "submit_runtime_state_delta", "submit_chapter_review", "submit_state_validation",
      "submit_chapter_range_replacements",
    ]) {
      expect(requests.get(name)?.[0], name).toContain("на русском языке");
    }
    expect(requests.get("submit_chapter_draft")?.[0]).toContain("9 слов");
    expect(requests.get("submit_chapter_review")?.[0]).toContain(original);
    expect(requests.get("submit_chapter_range_replacements")?.[1]).toContain("CHAPTER_LENGTH_OUT_OF_RANGE");

    expect(await pipeline.writeNextChapter(bookId)).toMatchObject({ chapterNumber: 2, wordCount: 9 });
    expect(requests.get("submit_chapter_memo")?.[1]).toContain(revised);
    expect((await loadRuntimeStateSnapshot(bookDir)).manifest.lastAppliedChapter).toBe(2);
  } finally {
    fetchWithProxy.mockReset();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
