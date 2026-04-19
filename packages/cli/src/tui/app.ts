import { access } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  appendInteractionMessage,
  processProjectInteractionInput,
  type InteractionRuntimeTools,
} from "@actalk/inkos-core";
import { render } from "ink";
import React from "react";
import { InkTuiApp } from "./dashboard.js";
import { formatModeLabel, getTuiCopy, normalizeStageLabel, resolveTuiLocale, type TuiLocale } from "./i18n.js";
import { formatTuiResult } from "./output.js";
import { loadProjectSession, persistProjectSession } from "./session-store.js";
import { detectModelInfo, detectProjectLanguage, ensureProject, interactiveLlmSetup } from "./setup.js";
import { createInteractionTools } from "./tools.js";
import { animateStartup } from "./effects.js";

export interface TuiFrameState {
  readonly locale?: TuiLocale;
  readonly projectName: string;
  readonly activeBookTitle?: string;
  readonly automationMode: string;
  readonly status: string;
  readonly messages?: ReadonlyArray<string>;
  readonly events?: ReadonlyArray<string>;
}

export function renderTuiFrame(state: TuiFrameState): string {
  const locale = state.locale ?? resolveTuiLocale();
  const copy = getTuiCopy(locale);
  const lines = [
    `${copy.labels.project} ${state.projectName}`,
    `${copy.labels.stage} ${normalizeStageLabel(state.status, copy)}`,
    `${copy.labels.mode} ${formatModeLabel(state.automationMode, copy)}`,
    `${copy.labels.book} ${state.activeBookTitle ?? copy.labels.none}`,
    "",
    ...(state.messages?.length
      ? state.messages.slice(-6).map((message) => `- ${message}`)
      : [`- (${copy.labels.none})`]),
    "",
    state.events?.length
      ? state.events.slice(-1).map((event) => `${copy.labels.recent} ${event}`)[0]!
      : `${copy.labels.recent} (${copy.labels.none})`,
    "",
    copy.composer.placeholder,
    "> ",
  ];
  return lines.join("\n");
}

async function readVersion(): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
    return pkg.version ?? "dev";
  } catch {
    return "dev";
  }
}

export async function processTuiInput(
  projectRoot: string,
  input: string,
  tools: InteractionRuntimeTools,
) {
  const projectLanguage = await detectProjectLanguage(projectRoot);
  const locale = resolveTuiLocale(process.env, projectLanguage);
  const result = await processProjectInteractionInput({
    projectRoot,
    input,
    tools,
  });
  const summary = formatTuiResult({
    intent: result.request.intent,
    status: result.session.currentExecution?.status ?? "completed",
    bookId: result.session.activeBookId,
    mode: result.request.mode,
    responseText: result.responseText,
    locale,
  });
  const nextSession = appendInteractionMessage(result.session, {
    role: "assistant",
    content: summary,
    timestamp: Date.now(),
  });
  await persistProjectSession(projectRoot, nextSession);
  return { ...result, session: nextSession };
}

async function resolveProjectRoot(cwd: string): Promise<string> {
  // If CWD is a book directory (contains book.json), walk up to the actual project root.
  // Structure: <projectRoot>/books/<bookId>/book.json
  try {
    await access(join(cwd, "book.json"));
    const parent = dirname(cwd);
    if (basename(parent) === "books") {
      return dirname(parent);
    }
  } catch {
    // not a book directory
  }
  return cwd;
}

export async function launchTui(
  projectRoot: string,
  toolsOverride?: InteractionRuntimeTools,
): Promise<void> {
  projectRoot = await resolveProjectRoot(projectRoot);
  const { hasLlmConfig } = await ensureProject(projectRoot);
  const projectLanguage = await detectProjectLanguage(projectRoot);
  const locale = resolveTuiLocale(process.env, projectLanguage);
  const copy = getTuiCopy(locale);

  if (!hasLlmConfig) {
    console.log();
    console.log(copy.notes.noLlmConfig);
    console.log(copy.notes.setupProvider);
    await interactiveLlmSetup(projectRoot);
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return;
  }

  const session = await loadProjectSession(projectRoot);
  const modelInfo = await detectModelInfo(projectRoot);
  const modelLabel = modelInfo
    ? `${modelInfo.model && modelInfo.model !== "unknown" ? modelInfo.model : copy.labels.unknown} (${modelInfo.provider})`
    : copy.labels.notConfigured;
  const version = await readVersion();
  const chatStreamBridge: { onTextDelta?: (text: string) => void } = {};

  let tools: InteractionRuntimeTools;
  try {
    tools = toolsOverride ?? (await createInteractionTools(projectRoot, {
      onChatTextDelta: (text) => {
        chatStreamBridge.onTextDelta?.(text);
      },
      onDraftTextDelta: (text) => {
        chatStreamBridge.onTextDelta?.(text);
      },
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(copy.notes.toolInitFailed(message));
    console.error(copy.notes.toolInitHint);
    return;
  }

  const originalEmitWarning = process.emitWarning;
  process.emitWarning = (() => {}) as typeof process.emitWarning;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString();
    if (text.includes("ExperimentalWarning") || text.includes("--trace-warnings")) {
      return true;
    }
    return (originalStderrWrite as Function)(chunk, ...args);
  };

  try {
    await animateStartup(version, basename(projectRoot), session.activeBookId, modelInfo);

    const app = render(
      React.createElement(InkTuiApp, {
        locale,
        projectRoot,
        projectName: basename(projectRoot),
        modelLabel,
        initialSession: session,
        tools,
        chatStreamBridge,
      }),
      { exitOnCtrlC: true },
    );
    await app.waitUntilExit();
  } finally {
    process.emitWarning = originalEmitWarning;
    process.stderr.write = originalStderrWrite;
  }
}
