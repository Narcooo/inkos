import { Command } from "commander";
import {
  processProjectInteractionInput,
  type InteractionRuntimeTools,
} from "@actalk/inkos-core";
import { createInteractionTools } from "../tui/tools.js";

export interface InteractCommandHooks {
  readonly runInteraction?: (params: {
    readonly projectRoot: string;
    readonly input: string;
    readonly activeBookId?: string;
    readonly tools: InteractionRuntimeTools;
  }) => Promise<{
    readonly request: unknown;
    readonly responseText?: string;
    readonly session: {
      readonly automationMode: string;
      readonly activeBookId?: string;
      readonly currentExecution?: unknown;
      readonly pendingDecision?: unknown;
      readonly messages: ReadonlyArray<unknown>;
      readonly events: ReadonlyArray<unknown>;
    };
  }>;
  readonly createTools?: (projectRoot: string) => Promise<InteractionRuntimeTools>;
  readonly readInput?: () => Promise<string>;
}

async function readInteractionInput(
  args: ReadonlyArray<string>,
  explicitMessage: string | undefined,
  readInput?: () => Promise<string>,
): Promise<string> {
  const explicit = explicitMessage?.trim();
  if (explicit) {
    return explicit;
  }

  const inline = args.join(" ").trim();
  if (inline) {
    return inline;
  }

  if (readInput) {
    const provided = (await readInput()).trim();
    if (provided) {
      return provided;
    }
  }

  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const piped = Buffer.concat(chunks).toString("utf-8").trim();
    if (piped) {
      return piped;
    }
  }

  throw new Error("Interaction message is required. Pass text arguments or pipe input via stdin.");
}

export function createInteractCommand(hooks: InteractCommandHooks = {}): Command {
  return new Command("interact")
    .description("Run a shared natural-language interaction against the current project")
    .argument("[message...]", "Natural-language message")
    .option("--message <text>", "Explicit natural-language message")
    .option("--book <bookId>", "Bind a specific active book for this interaction")
    .option("--json", "Emit structured JSON for external agents")
    .action(async (messageArgs: ReadonlyArray<string>, opts) => {
      const input = await readInteractionInput(messageArgs, opts.message, hooks.readInput);
      const projectRoot = process.cwd();
      const tools = hooks.createTools
        ? await hooks.createTools(projectRoot)
        : hooks.runInteraction
          ? ({} as InteractionRuntimeTools)
          : await createInteractionTools(projectRoot, undefined, { requireApiKey: false });
      const runInteraction = hooks.runInteraction ?? processProjectInteractionInput;
      const result = await runInteraction({
        projectRoot,
        input,
        activeBookId: opts.book,
        tools,
      });

      if (opts.json) {
        process.stdout.write(`${JSON.stringify({
          request: result.request,
          responseText: result.responseText,
          session: result.session,
          currentExecution: result.session.currentExecution ?? null,
          pendingDecision: result.session.pendingDecision ?? null,
          events: result.session.events,
        }, null, 2)}\n`);
        return;
      }

      const text = result.responseText
        ?? (result.session.messages.at(-1) && "content" in (result.session.messages.at(-1) as Record<string, unknown>)
          ? String((result.session.messages.at(-1) as Record<string, unknown>).content)
          : "");
      if (text) {
        process.stdout.write(`${text}\n`);
      }
    });
}
