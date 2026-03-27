import { beforeEach, describe, expect, it, vi } from "vitest";

const requestJsonMock = vi.fn();
const runActionMock = vi.fn(async (_message: string, task: () => Promise<unknown>) => task());
const showToastMock = vi.fn();
const setViewMock = vi.fn();
const buildSidebarTreeMock = vi.fn();
const renderDashboardMock = vi.fn();

const elements = new Map<string, Record<string, unknown>>();
let formValues: Record<string, unknown> = {};

vi.mock("../../../studio/public/js/utils.js", () => ({
  $: (id: string) => elements.get(id),
  requestJson: requestJsonMock,
  runAction: runActionMock,
  showToast: showToastMock,
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

describe("studio frontend regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    elements.clear();
    formValues = {};

    vi.stubGlobal("FormData", class MockFormData {
      get(name: string) {
        return formValues[name];
      }
    });
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
        return null;
      },
    });

    requestJsonMock.mockResolvedValueOnce({
      ok: true,
      data: { bookId: "新书测试" },
    });

    const loadBooksMock = vi.fn(async () => undefined);
    const preventDefault = vi.fn();
    const formsModulePath = "../../../studio/public/js/forms.js";
    const { createBook } = await import(formsModulePath);

    await createBook({ preventDefault } as unknown as Event, loadBooksMock);

    expect(preventDefault).toHaveBeenCalled();
    expect(loadBooksMock).toHaveBeenCalledTimes(1);
    expect(setViewMock).toHaveBeenCalledWith("dashboard");
    expect(renderDashboardMock).toHaveBeenCalledTimes(1);
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
        return null;
      },
    });

    requestJsonMock.mockResolvedValueOnce({
      ok: false,
      error: "LLM returned empty response",
    });

    const loadBooksMock = vi.fn(async () => undefined);
    const preventDefault = vi.fn();
    const formsModulePath = "../../../studio/public/js/forms.js";
    const { createBook } = await import(formsModulePath);

    await expect(createBook({ preventDefault } as unknown as Event, loadBooksMock)).rejects.toThrow(
      "LLM returned empty response",
    );

    expect(loadBooksMock).not.toHaveBeenCalled();
    expect(setViewMock).not.toHaveBeenCalledWith("dashboard");
    expect(renderDashboardMock).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalledWith(expect.stringContaining("书籍已创建"));
  });

  it("treats a successful doctor response with code=0 as connected", async () => {
    const statusEl = { textContent: "", className: "" };
    elements.set("doctor-status", statusEl);

    requestJsonMock.mockResolvedValueOnce({
      code: 0,
      stdout: "doctor ok",
    });

    const settingsModulePath = "../../../studio/public/js/settings.js";
    const { runDoctor } = await import(settingsModulePath);

    await runDoctor();

    expect(requestJsonMock).toHaveBeenCalledWith("/api/doctor");
    expect(statusEl.textContent).toBe("连通正常");
    expect(statusEl.className).toBe("settings-doctor-status ok");
  });
});
