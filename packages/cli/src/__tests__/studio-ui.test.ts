import { beforeEach, describe, expect, it, vi } from "vitest";

const showToastMock = vi.fn();
const setStatusMock = vi.fn();
const setViewMock = vi.fn();
const buildSidebarTreeMock = vi.fn();
const renderDashboardMock = vi.fn();
const requestJsonMock = vi.fn();

const elements = new Map<string, Record<string, unknown>>();
let formValues: Record<string, unknown> = {};

vi.mock("../../../studio/public/js/utils.js", () => ({
  $: (id: string) => elements.get(id),
  requestJson: requestJsonMock,
  runAction: vi.fn(async (_message: string, task: () => Promise<unknown>) => {
    try {
      return await task();
    } catch (err) {
      showToastMock(String((err as Error).message || err), "error");
      return undefined;
    }
  }),
  showToast: showToastMock,
  setStatus: setStatusMock,
}));

vi.mock("../../../studio/public/js/views.js", () => ({
  setView: setViewMock,
}));

vi.mock("../../../studio/public/js/sidebar.js", () => ({
  buildSidebarTree: buildSidebarTreeMock,
}));

vi.mock("../../../studio/public/js/dashboard.js", () => ({
  renderDashboard: renderDashboardMock,
}));

vi.mock("../../../studio/public/js/state.js", () => ({
  state: {
    activeBookId: "",
  },
}));

/** Build a mock Response whose body is an SSE stream. */
function mockSSEResponse(events: Array<{ event: string; data: unknown }>) {
  const lines = events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join("");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function mockSplitSSEResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("studio frontend regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    elements.clear();
    formValues = {};

    vi.stubGlobal(
      "FormData",
      class MockFormData {
        get(name: string) {
          return formValues[name];
        }
      },
    );
  });

  it("returns to the dashboard and re-renders the bookshelf after creating a book", async () => {
    formValues = {
      title: "新书测试",
      genre: "xuanhuan",
      platform: "tomato",
      targetChapters: "200",
      chapterWords: "3000",
      brief: "",
    };

    elements.set("create-form", {
      querySelector: (selector: string) => {
        if (selector.includes("useProjectBrief")) return { checked: true };
        if (selector.includes("writeFirstChapter")) return { checked: false };
        if (selector.includes("submit")) return { disabled: false };
        return null;
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        mockSSEResponse([
          { event: "progress", data: { stage: "保存书籍配置" } },
          { event: "progress", data: { stage: "生成基础设定" } },
          { event: "done", data: { ok: true, data: { bookId: "新书测试" } } },
        ]),
      ),
    );

    const loadBooksMock = vi.fn(async () => undefined);
    const preventDefault = vi.fn();
    // @ts-expect-error -- JS module without declarations
    const { createBook } = await import("../../../studio/public/js/forms.js");

    await createBook({ preventDefault } as unknown as Event, loadBooksMock);

    expect(preventDefault).toHaveBeenCalled();
    expect(loadBooksMock).toHaveBeenCalledTimes(1);
    expect(setViewMock).toHaveBeenCalledWith("dashboard");
    expect(renderDashboardMock).toHaveBeenCalledTimes(1);
    expect(setStatusMock).toHaveBeenCalledWith("保存书籍配置");
  });

  it("parses SSE events correctly even when event and data arrive in separate chunks", async () => {
    formValues = {
      title: "分片新书",
      genre: "xuanhuan",
      platform: "tomato",
      targetChapters: "200",
      chapterWords: "3000",
      brief: "",
    };

    elements.set("create-form", {
      querySelector: (selector: string) => {
        if (selector.includes("useProjectBrief")) return { checked: true };
        if (selector.includes("writeFirstChapter")) return { checked: false };
        if (selector.includes("submit")) return { disabled: false };
        return null;
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        mockSplitSSEResponse([
          "event: progress\n",
          'data: {"stage":"保存书籍配置"}\n\n',
          "event: done\n",
          'data: {"ok":true,"data":{"bookId":"分片新书"}}\n\n',
        ]),
      ),
    );

    const loadBooksMock = vi.fn(async () => undefined);
    const preventDefault = vi.fn();
    // @ts-expect-error -- JS module without declarations
    const { createBook } = await import("../../../studio/public/js/forms.js");

    await createBook({ preventDefault } as unknown as Event, loadBooksMock);

    expect(setStatusMock).toHaveBeenCalledWith("保存书籍配置");
    expect(setViewMock).toHaveBeenCalledWith("dashboard");
  });

  it("does not report success when book creation returns ok=false", async () => {
    formValues = {
      title: "失败新书",
      genre: "xuanhuan",
      platform: "tomato",
      targetChapters: "200",
      chapterWords: "3000",
      brief: "",
    };

    elements.set("create-form", {
      querySelector: (selector: string) => {
        if (selector.includes("useProjectBrief")) return { checked: true };
        if (selector.includes("writeFirstChapter")) return { checked: false };
        if (selector.includes("submit")) return { disabled: false };
        return null;
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        mockSSEResponse([
          { event: "done", data: { ok: false, error: "LLM returned empty response" } },
        ]),
      ),
    );

    const loadBooksMock = vi.fn(async () => undefined);
    const preventDefault = vi.fn();
    // @ts-expect-error -- JS module without declarations
    const { createBook } = await import("../../../studio/public/js/forms.js");

    await createBook({ preventDefault } as unknown as Event, loadBooksMock);

    expect(loadBooksMock).not.toHaveBeenCalled();
    expect(setViewMock).not.toHaveBeenCalledWith("dashboard");
    expect(renderDashboardMock).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalledWith(expect.stringContaining("书籍已创建"));
    expect(showToastMock).toHaveBeenCalledWith("LLM returned empty response", "error");
  });

  it("treats a successful doctor response with code=0 as connected", async () => {
    const statusEl = { textContent: "", className: "" };
    elements.set("doctor-status", statusEl);

    requestJsonMock.mockResolvedValueOnce({
      code: 0,
      stdout: "doctor ok",
    });

    // @ts-expect-error -- JS module without declarations
    const { runDoctor } = await import("../../../studio/public/js/settings.js");

    await runDoctor();

    expect(requestJsonMock).toHaveBeenCalledWith("/api/doctor");
    expect(statusEl.textContent).toBe("连通正常");
    expect(statusEl.className).toBe("settings-doctor-status ok");
  });

  it("shows English stage updates that come from the server progress stream", async () => {
    formValues = {
      title: "english-stage-book",
      genre: "xuanhuan",
      platform: "tomato",
      targetChapters: "200",
      chapterWords: "3000",
      brief: "",
    };

    elements.set("create-form", {
      querySelector: (selector: string) => {
        if (selector.includes("useProjectBrief")) return { checked: true };
        if (selector.includes("writeFirstChapter")) return { checked: false };
        if (selector.includes("submit")) return { disabled: false };
        return null;
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        mockSSEResponse([
          { event: "progress", data: { stage: "Stage: Persisting project files" } },
          { event: "done", data: { ok: true, data: { bookId: "english-stage-book" } } },
        ]),
      ),
    );

    const loadBooksMock = vi.fn(async () => undefined);
    const preventDefault = vi.fn();
    // @ts-expect-error -- JS module without declarations
    const { createBook } = await import("../../../studio/public/js/forms.js");

    await createBook({ preventDefault } as unknown as Event, loadBooksMock);

    expect(setStatusMock).toHaveBeenCalledWith("Stage: Persisting project files");
  });
});
