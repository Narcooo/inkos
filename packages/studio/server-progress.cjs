function extractProgressStages(text) {
  const stages = [];
  const lines = String(text ?? "").split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    const stageMatch = line.match(/(?:阶段|Stage)\s*[:：]\s*(.+)/i);
    if (stageMatch) {
      stages.push(stageMatch[1]);
      continue;
    }

    const streamMatch = line.match(/streaming (\d+)s,\s*(\d+)\s*chars/i);
    if (streamMatch) {
      stages.push(`生成基础设定 (${streamMatch[1]}s, ${streamMatch[2]} chars)`);
    }
  }

  return stages;
}

module.exports = {
  extractProgressStages,
};
