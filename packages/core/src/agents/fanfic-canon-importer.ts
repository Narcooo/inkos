import { BaseAgent } from "./base.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * FanficCanonImporter — parses source material (parent book truth files)
 * into a structured fanfic_canon.md for the target fanfic book.
 *
 * The canon file includes:
 * - Character profiles (personality, speech patterns, motivations)
 * - World rules (magic system, technology, social structure)
 * - Relationship map (character dynamics)
 * - Timeline of canon events
 * - Key locations and artifacts
 */
export class FanficCanonImporter extends BaseAgent {
  get name(): string {
    return "fanfic-canon-importer";
  }

  /**
   * Parse parent book truth files and generate fanfic_canon.md.
   * Reads: story_bible, current_state, character_matrix, volume_outline from parent.
   * Writes: fanfic_canon.md to the target book's story dir.
   */
  async importCanon(
    targetBookDir: string,
    parentBookDir: string,
    fanficMode: "canon" | "au" | "ooc" | "cp" = "canon",
  ): Promise<string> {
    const parentStoryDir = join(parentBookDir, "story");

    // Read all available truth files from parent
    const files: Record<string, string> = {};
    const truthFiles = [
      "story_bible.md", "current_state.md", "character_matrix.md",
      "volume_outline.md", "chapter_summaries.md", "emotional_arcs.md",
    ];

    for (const name of truthFiles) {
      try {
        files[name] = await readFile(join(parentStoryDir, name), "utf-8");
      } catch {
        // File doesn't exist — skip
      }
    }

    if (Object.keys(files).length === 0) {
      throw new Error(`No truth files found in parent book: ${parentBookDir}`);
    }

    // Build context for LLM
    const sourceContext = Object.entries(files)
      .map(([name, content]) => `### ${name}\n${content}`)
      .join("\n\n---\n\n");

    const modeDescription = {
      canon: "严格正典模式：角色、世界、事件必须完全忠于原作。",
      au: "AU（平行世界）模式：世界观可修改，但角色核心性格应保留。",
      ooc: "OOC（角色崩坏允许）模式：允许角色性格偏离原作，但世界观保持一致。",
      cp: "CP（配对向）模式：重点是角色关系发展，关系动态审查最严格。",
    }[fanficMode];

    const systemPrompt = `你是一位同人文学研究专家。你的任务是从原作资料中提取结构化的正典数据，用于同人写作参考和审计。

当前模式：${modeDescription}

请从提供的原作资料中提取以下结构化信息，输出为 Markdown 格式：

## 1. 角色档案
对每个主要角色，提取：
| 角色 | 核心性格 | 说话风格 | 口头禅/用词习惯 | 核心动机 | 行为底线 |
|------|----------|----------|-----------------|----------|----------|

## 2. 世界规则
- 力量体系规则（如有）
- 科技/魔法水平
- 社会结构/阵营
- 重要限制/禁忌

## 3. 关系图谱
| 角色A | 角色B | 关系类型 | 关系发展轨迹 | 关键转折点 |
|-------|-------|----------|-------------|-----------|

## 4. 正典事件时间线
| 时间/章节 | 事件 | 参与角色 | 影响 |
|-----------|------|----------|------|

## 5. 重要地点与道具
| 名称 | 类型 | 首次出现 | 重要性 | 描述 |
|------|------|----------|--------|------|

注意：
- 只提取原作中明确呈现的信息，不要推测
- 保留原作用语和称谓
- 标注信息来源（来自哪个文件）`;

    const userPrompt = `以下是原作的真相文件，请提取结构化正典数据：

${sourceContext}`;

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: 8192, temperature: 0.3 },
    );

    const canonContent = response.content;

    // Write fanfic_canon.md to target book
    const targetStoryDir = join(targetBookDir, "story");
    await mkdir(targetStoryDir, { recursive: true });
    await writeFile(
      join(targetStoryDir, "fanfic_canon.md"),
      `# 同人正典参照（${fanficMode}模式）\n\n${canonContent}`,
      "utf-8",
    );

    return canonContent;
  }

  /**
   * Refresh the fanfic_canon.md file by re-reading parent book state.
   * Useful when the parent book has new chapters that change canon.
   */
  async refreshCanon(
    targetBookDir: string,
    parentBookDir: string,
    fanficMode: "canon" | "au" | "ooc" | "cp" = "canon",
  ): Promise<string> {
    return this.importCanon(targetBookDir, parentBookDir, fanficMode);
  }

  /**
   * Show current fanfic_canon.md content if it exists.
   */
  async showCanon(bookDir: string): Promise<string | null> {
    try {
      return await readFile(join(bookDir, "story", "fanfic_canon.md"), "utf-8");
    } catch {
      return null;
    }
  }
}
