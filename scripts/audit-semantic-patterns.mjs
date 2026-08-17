#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  "packages/core/src",
  "packages/studio/src",
  "packages/cli/src",
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

const ACTION_SURFACE_PATHS = [
  "packages/core/src/agent/",
  "packages/core/src/interaction/",
  "packages/studio/src/api/server.ts",
  "packages/studio/src/pages/BookCreate.tsx",
  "packages/cli/src/commands/agent.ts",
  "packages/cli/src/tui/",
];

const SEMANTIC_HINTS = [
  "instruction",
  "intent",
  "requestedIntent",
  "actionSource",
  "free-text",
  "continue",
  "write next",
  "create book",
  "edit",
  "rewrite",
  "revise",
  "play",
  "short",
  "fanfic",
  "spinoff",
  "imitation",
  "续写",
  "继续",
  "建书",
  "短篇",
  "互动",
  "番外",
  "仿写",
  "同人",
];

const PATTERN_TOKENS = [
  ".match(",
  ".test(",
  ".includes(",
  ".startsWith(",
  ".endsWith(",
  "new RegExp(",
];

function hasAny(text, words) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word.toLowerCase()));
}

function isActionSurface(path) {
  const rel = path.replace(`${ROOT}/`, "");
  return ACTION_SURFACE_PATHS.some((prefix) => rel.startsWith(prefix));
}

function isLikelySemanticDecision(path, line, windowText) {
  if (!isActionSurface(path)) return false;
  if (!PATTERN_TOKENS.some((token) => line.includes(token))) return false;
  if (!hasAny(`${line}\n${windowText}`, SEMANTIC_HINTS)) return false;
  if (line.includes("CHAT_EDIT_TEXT_EXTENSIONS")) return false;
  if (line.includes("SAFE_ROLE_TRUTH_FILE_RE")) return false;
  if (path.endsWith("agent-tools.ts") && line.includes("current.includes(")) return false;
  if (path.endsWith("skill-tool.ts") && line.includes("body.includes(\"\\0\")")) return false;
  if (line.includes("RUNTIME_DIAGNOSTIC_FILE_RE")) return false;
  if (line.includes("runtimeDiagnostic")) return false;
  if (line.includes("startsWith(\"scene-turn-\")")) return false;
  if (line.includes("PlannerParseError") && line.includes(".test(text)")) return false;
  if (line.includes("CODE_FENCE_RE") || line.includes("DIRECTIVE_CLOSE_RE")) return false;
  if (line.includes("safeSessionId")) return false;
  if (line.includes("genreId")) return false;
  if (line.includes("relPath") || line.includes("targetPath") || line.includes("requestedPath")) return false;
  if (line.includes("entry.name") || line.includes("base.includes") || line.includes("escapeRegExp")) return false;
  if (line.includes("raw.includes(\"/\")") || line.includes("raw.includes(\"\\\\\")")) return false;
  if (line.includes("Manual text edit requires review")) return false;
  if (path.endsWith("project-tools.ts") && line.includes("includes(")) return false;
  if (path.endsWith("i18n.ts")) return false;
  if (line.includes("rel || rel.startsWith")) return false;
  if (line.includes("trimmed.match(/^([A-Za-z_]")) return false;
  if (line.includes("file.includes(\"/\")")) return false;
  if (line.includes("startsWith(\"[Tool results]\")")) return false;
  if (line.includes("already processing") || line.includes("prompt.*queue")) return false;
  if (line.includes("trimmed.startsWith(\"#\")")) return false;
  if (line.includes("actionSource") && line.includes("startsWith(\"/\")")) return false;
  if (line.includes("startsWith(\"/\")")) return false;
  if (line.includes("endsWith(") && !hasAny(windowText, ["instruction", "intent"])) return false;
  return true;
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
      out.push(...await walk(path));
    } else if (SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf(".")))) {
      out.push(path);
    }
  }
  return out;
}

const files = [];
for (const dir of SCAN_DIRS) {
  files.push(...await walk(join(ROOT, dir)));
}

const findings = [];
for (const file of files) {
  const content = await readFile(file, "utf-8");
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const windowText = lines.slice(Math.max(0, index - 4), Math.min(lines.length, index + 5)).join("\n");
    if (isLikelySemanticDecision(file, line, windowText)) {
      findings.push({
        file: relative(ROOT, file),
        line: index + 1,
        text: line.trim(),
      });
    }
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ findings }, null, 2));
} else {
  console.log(`Semantic/template-pattern audit candidates: ${findings.length}`);
  for (const finding of findings) {
    console.log(`${finding.file}:${finding.line}  ${finding.text}`);
  }
}

if (findings.length > 0) process.exitCode = 1;
