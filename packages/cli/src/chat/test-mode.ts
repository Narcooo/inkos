/**
 * TUI测试启动器
 * 用于手动测试InkOS聊天界面
 *
 * 使用方法：
 * npx tsx packages/cli/src/chat/test-mode.ts
 */

import { startChat } from "./index.js";
import { ChatHistoryManager } from "./history.js";
import { rm } from "node:fs/promises";

async function main() {
  console.log("=== InkOS TUI 测试模式 ===\n");

  // 创建测试环境
  const testDir = ".test-tui-chat-history";
  console.log(`测试历史目录: ${testDir}`);

  // 清理旧的测试数据
  await rm(testDir, { recursive: true, force: true }).catch(() => {});
  console.log("✓ 清理旧测试数据\n");

  // 创建测试历史管理器
  const historyManager = new ChatHistoryManager({
    historyDir: testDir,
    maxMessages: 100,
  });

  // 预填充一些测试消息
  const testBookId = "test-book";
  let history = await historyManager.load(testBookId);

  history = historyManager.addMessage(history, {
    role: "user",
    content: "这是第一条测试消息",
    timestamp: new Date(Date.now() - 60000).toISOString(),
  });

  history = historyManager.addMessage(history, {
    role: "assistant",
    content: "收到测试消息！这是历史消息测试。",
    timestamp: new Date(Date.now() - 59000).toISOString(),
    tokenUsage: {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    },
  });

  await historyManager.save(history);
  console.log("✓ 预填充测试历史消息\n");

  // 测试场景提示
  console.log("=== 测试场景 ===");
  console.log("1. 基本输入测试：输入普通文本");
  console.log("2. 命令补全测试：输入 / 然后按 Tab");
  console.log("3. 命令导航测试：输入 / 然后按 ↑↓");
  console.log("4. 历史消息测试：查看预填充的消息");
  console.log("5. 清空测试：输入 /clear");
  console.log("6. 帮助测试：输入 /help");
  console.log("7. 退出测试：输入 /exit 或按 Esc\n");

  console.log("=== 启动TUI ===\n");

  try {
    // 启动聊天界面（使用测试book ID）
    await startChat(testBookId, {
      maxMessages: 100,
    });
  } catch (error) {
    console.error("TUI启动失败:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("测试失败:", error);
  process.exit(1);
});