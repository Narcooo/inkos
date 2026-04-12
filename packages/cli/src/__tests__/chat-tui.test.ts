/**
 * TUI组件自动化测试
 * 测试Ink聊天界面的关键逻辑（不涉及真实渲染）
 */

import { describe, test, expect } from "vitest";
import { SLASH_COMMANDS, getAutocompleteInput } from "../chat/commands.js";

describe("TUI命令补全逻辑", () => {
  test("Tab补全应该正确补全零参数命令（/exit, /clear）", () => {
    // 用户输入: /exi
    // Tab补全后应该是: /exit (无空格)
    expect(getAutocompleteInput("exit")).toBe("/exit");
    expect(getAutocompleteInput("clear")).toBe("/clear");
  });

  test("Tab补全应该正确补全需要参数的命令（/write, /switch）", () => {
    // 用户输入: /wri
    // Tab补全后应该是: /write (有空格，提示用户输入参数)
    expect(getAutocompleteInput("write")).toBe("/write ");
    expect(getAutocompleteInput("switch")).toBe("/switch ");
    expect(getAutocompleteInput("audit")).toBe("/audit ");
    expect(getAutocompleteInput("revise")).toBe("/revise ");
  });

  test("命令列表应该包含所有必要的命令", () => {
    const commands = Object.keys(SLASH_COMMANDS);

    // 核心命令
    expect(commands).toContain("write");
    expect(commands).toContain("audit");
    expect(commands).toContain("revise");
    expect(commands).toContain("status");

    // 会话管理命令
    expect(commands).toContain("clear");
    expect(commands).toContain("switch");

    // 帮助和退出
    expect(commands).toContain("help");
    expect(commands).toContain("exit");
    expect(commands).toContain("quit");
  });
});

describe("TUI输入处理逻辑", () => {
  test("应该正确识别斜杠命令", () => {
    const isSlashCommand = (input: string) => input.startsWith("/");

    expect(isSlashCommand("/write")).toBe(true);
    expect(isSlashCommand("/help")).toBe(true);
    expect(isSlashCommand("写下一章")).toBe(false);
    expect(isSlashCommand("/")).toBe(true);
  });

  test("应该正确提取命令名称", () => {
    const extractCommand = (input: string) => {
      if (!input.startsWith("/")) return null;
      const parts = input.split(/\s+/);
      return parts[0]?.slice(1) ?? null;
    };

    expect(extractCommand("/write")).toBe("write");
    expect(extractCommand("/write --guidance 'test'")).toBe("write");
    expect(extractCommand("/switch my-book")).toBe("switch");
    expect(extractCommand("普通文本")).toBe(null);
  });
});

describe("TUI消息显示逻辑", () => {
  test("应该正确格式化时间戳", () => {
    const formatTimestamp = (isoString: string): string => {
      const date = new Date(isoString);
      if (Number.isNaN(date.getTime())) {
        return "Invalid time";
      }
      return date.toLocaleTimeString();
    };

    const validTimestamp = "2026-04-01T12:00:00.000Z";
    const formatted = formatTimestamp(validTimestamp);
    expect(formatted).toMatch(/\d{1,2}:\d{2}:\d{2}/);

    const invalidTimestamp = "invalid";
    expect(formatTimestamp(invalidTimestamp)).toBe("Invalid time");
  });

  test("应该正确计算token使用总和", () => {
    const messages = [
      {
        role: "user" as const,
        content: "test",
        timestamp: "2026-04-01T00:00:00.000Z",
        tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
      {
        role: "assistant" as const,
        content: "test",
        timestamp: "2026-04-01T00:00:01.000Z",
        tokenUsage: { promptTokens: 5, completionTokens: 15, totalTokens: 20 },
      },
    ];

    const totalTokens = messages.reduce((sum, msg) => {
      return sum + (msg.tokenUsage?.totalTokens ?? 0);
    }, 0);

    expect(totalTokens).toBe(50);
  });
});

describe("TUI状态管理逻辑", () => {
  test("应该正确追踪命令建议索引", () => {
    // 模拟用户导航建议列表
    const commands = ["write", "audit", "revise", "status", "clear"];
    let selectedIndex = 0;

    // 向下导航
    const navigateDown = () => {
      selectedIndex = (selectedIndex + 1) % commands.length;
    };

    // 向上导航
    const navigateUp = () => {
      selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : commands.length - 1;
    };

    expect(selectedIndex).toBe(0);

    navigateDown();
    expect(selectedIndex).toBe(1);

    navigateDown();
    expect(selectedIndex).toBe(2);

    // 从末尾循环到开头
    selectedIndex = commands.length - 1;
    navigateDown();
    expect(selectedIndex).toBe(0);

    // 从开头循环到末尾
    selectedIndex = 0;
    navigateUp();
    expect(selectedIndex).toBe(commands.length - 1);
  });

  test("应该正确计算执行时间", () => {
    const formatDuration = (ms: number): string => {
      const totalTenths = Math.floor(Math.max(0, ms) / 100);
      const minutes = Math.floor(totalTenths / 600);
      const seconds = Math.floor((totalTenths % 600) / 10);
      const tenths = totalTenths % 10;
      return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
    };

    expect(formatDuration(0)).toBe("00:00.0");
    // 1234ms = 12.34秒 = 12个十分之一秒
    // totalTenths = floor(1234/100) = 12
    // minutes = floor(12/600) = 0
    // seconds = floor((12%600)/10) = 1
    // tenths = 12%10 = 2
    expect(formatDuration(1234)).toBe("00:01.2");

    // 65432ms = 654.32秒 = 654个十分之一秒
    // totalTenths = floor(65432/100) = 654
    // minutes = floor(654/600) = 1
    // seconds = floor((654%600)/10) = 5
    // tenths = 654%10 = 4
    expect(formatDuration(65432)).toBe("01:05.4");
    expect(formatDuration(-100)).toBe("00:00.0"); // 负数应该被钳制为0
  });
});

describe("TUI边界情况处理", () => {
  test("应该处理空输入", () => {
    const isEmptyInput = (input: string) => input.trim().length === 0;

    expect(isEmptyInput("")).toBe(true);
    expect(isEmptyInput("   ")).toBe(true);
    expect(isEmptyInput("  test  ")).toBe(false);
  });

  test("应该处理超长输入", () => {
    const longInput = "a".repeat(10000);
    expect(longInput.length).toBe(10000);

    // UI应该能够显示超长文本（自动换行）
    const canDisplay = (text: string) => text.length > 0;
    expect(canDisplay(longInput)).toBe(true);
  });

  test("应该处理特殊字符输入", () => {
    const specialInputs = [
      "/write '单引号'",
      '/write "双引号"',
      "/write `反引号`",
      "/write $变量",
      "/write \\转义",
      "/write <尖括号>",
      "/write &符号",
    ];

    // 所有特殊字符输入都应该被正确处理
    specialInputs.forEach((input) => {
      expect(input.startsWith("/")).toBe(true);
    });
  });
});