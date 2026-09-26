import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QidianRadarSource } from "../../agents/radar-source.js";

/**
 * 起点雷达源:PC 端被瑞数 probe.js 拦死后改走移动端 H5(m.qidian.com/rank/)。
 * 单测不碰真实网络,只验证页面解析契约:书卡 title 后缀剥除、跨榜单去重、
 * 20 本上限,以及挑战页/网络错误的设计内空表降级。
 */

const fetchMock = vi.fn();
const ORIGINAL_FETCH = globalThis.fetch;

function mobileRankHtml(titles: string[]): string {
  // 移动端书卡结构(真实页面多榜段同页,同一本书会出现多次)
  return titles.map((t) =>
    `<a class="_bookWrapper_2b9mb_9" href="//m.qidian.com/book/10${t.length}0000001/" title="${t}最新章节在线阅读" data-bid="10${t.length}0000001">`
  ).join("\n");
}

const PROBE_CHALLENGE = `<!DOCTYPE html><html><head><meta charset="UTF-8"><script>var buid = "fffffffffffffffffff"</script><script src="/C2WF946J0/probe.js?v=vc1jasc"></script></head><body></body></html>`;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  void ORIGINAL_FETCH;
});

describe("QidianRadarSource", () => {
  it("移动端书卡 → 提取书名并剥掉「最新章节在线阅读」后缀", async () => {
    fetchMock.mockResolvedValue(new Response(mobileRankHtml(["夜无疆", "武道！", "玄鉴仙族"]), { status: 200 }));

    const result = await new QidianRadarSource().fetch();

    expect(result.platform).toBe("起点中文网");
    expect(result.entries.map((e) => e.title)).toEqual(["夜无疆", "武道！", "玄鉴仙族"]);
    expect(result.entries[0]!.extra).toBe("[起点热榜]");
    expect(fetchMock).toHaveBeenCalledWith("https://m.qidian.com/rank/", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; InkOS/0.1)" },
    });
  });

  it("同一本书跨榜重复出现 → 按书名去重,保留首见顺序", async () => {
    // 真实页面「月票榜/畅销榜/推荐榜」同页,热门书每段都出现
    fetchMock.mockResolvedValue(new Response(
      mobileRankHtml(["夜无疆", "武道！", "夜无疆", "捞尸人", "武道！"]),
      { status: 200 },
    ));

    const result = await new QidianRadarSource().fetch();

    expect(result.entries.map((e) => e.title)).toEqual(["夜无疆", "武道！", "捞尸人"]);
  });

  it("超过 20 本截断,只取前 20", async () => {
    const titles = Array.from({ length: 30 }, (_, i) => `榜单第${i}名`);
    fetchMock.mockResolvedValue(new Response(mobileRankHtml(titles), { status: 200 }));

    const result = await new QidianRadarSource().fetch();

    expect(result.entries).toHaveLength(20);
    expect(result.entries[0]!.title).toBe("榜单第0名");
    expect(result.entries[19]!.title).toBe("榜单第19名");
  });

  it("probe.js 挑战页(PC 端被拦形态)→ 空表降级,不炸", async () => {
    fetchMock.mockResolvedValue(new Response(PROBE_CHALLENGE, { status: 202 }));

    const result = await new QidianRadarSource().fetch();

    expect(result.platform).toBe("起点中文网");
    expect(result.entries).toEqual([]);
  });

  it("网络错误 → 空表降级,不抛", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const result = await new QidianRadarSource().fetch();

    expect(result.entries).toEqual([]);
  });

  it("书名带特殊字符与标点(问号/叹号/冒号)不误伤", async () => {
    fetchMock.mockResolvedValue(new Response(
      mobileRankHtml(["没钱修什么仙？", "1984：从川菜馆开始", "人在诸天，你这天庭正经吗？"]),
      { status: 200 },
    ));

    const result = await new QidianRadarSource().fetch();

    expect(result.entries.map((e) => e.title)).toEqual([
      "没钱修什么仙？",
      "1984：从川菜馆开始",
      "人在诸天，你这天庭正经吗？",
    ]);
  });
});
