/**
 * Extract human-readable progress stages from CLI stderr output.
 * Matches both Chinese and English, plus agent-specific log lines.
 */
function extractProgressStages(text) {
  const stages = [];
  const lines = String(text ?? "").split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    // Standard stage lines: "阶段：..." or "Stage: ..."
    const stageMatch = line.match(/(?:阶段|Stage)\s*[:：]\s*(.+)/i);
    if (stageMatch) {
      stages.push(stageMatch[1].trim());
      continue;
    }

    // Agent-specific phase lines: "[writer] 阶段 1：创作正文（第1章）"
    const agentPhase = line.match(/\[(\w[\w-]*)\]\s*(?:阶段|Phase)\s*\d+\w*\s*[:：]\s*(.+)/i);
    if (agentPhase) {
      stages.push(`[${agentPhase[1]}] ${agentPhase[2].trim()}`);
      continue;
    }

    // Streaming telemetry: "streaming 30s, 2003 chars (1269 CJK)"
    const streamMatch = line.match(/streaming (\d+)s,\s*(\d+)\s*chars(?:\s*\((\d+)\s*CJK\))?/i);
    if (streamMatch) {
      const cjk = streamMatch[3] ? `, ${streamMatch[3]} CJK` : "";
      stages.push(`流式生成中 (${streamMatch[1]}s, ${streamMatch[2]} chars${cjk})`);
      continue;
    }

    // Length normalization: "审计前字数归一化：第1章 6560 -> 2943"
    const normMatch = line.match(/字数归一化\s*[:：]\s*(.+)/i);
    if (normMatch) {
      stages.push(`字数归一化: ${normMatch[1].trim()}`);
      continue;
    }

    // Warnings: "WARN [writer] 伏笔健康：..." or "WARN [inkos] 状态校验：..."
    const warnMatch = line.match(/WARN\s+\[(\w[\w-]*)\]\s*(.+)/i);
    if (warnMatch) {
      stages.push(`⚠ [${warnMatch[1]}] ${warnMatch[2].trim()}`);
      continue;
    }

    // Hook health / state validation detail lines
    const detailMatch = line.match(/\[(warning|info|unsupported_change|hook_anomaly|missing_state_change)\]\s*(.+)/i);
    if (detailMatch) {
      stages.push(`  ${detailMatch[2].trim().slice(0, 120)}`);
      continue;
    }
  }

  return stages;
}

module.exports = {
  extractProgressStages,
};
