import { Command } from "commander";
import { launchTui } from "../tui/app.js";

export interface TuiCommandHooks {
  readonly launchTui?: (projectRoot: string) => Promise<void> | void;
}

export function createTuiCommand(hooks: TuiCommandHooks = {}): Command {
  return new Command("tui")
    .description("Open the InkOS project workspace TUI")
    .action(async () => {
      if (hooks.launchTui) {
        await hooks.launchTui(process.cwd());
        return;
      }
      await launchTui(process.cwd());
    });
}
