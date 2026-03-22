#!/usr/bin/env node

import { createRequire } from "node:module";
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { configCommand } from "./commands/config.js";
import { bookCommand } from "./commands/book.js";
import { writeCommand } from "./commands/write.js";
import { reviewCommand } from "./commands/review.js";
import { statusCommand } from "./commands/status.js";
import { radarCommand } from "./commands/radar.js";
import { upCommand, downCommand } from "./commands/daemon.js";
import { doctorCommand } from "./commands/doctor.js";
import { exportCommand } from "./commands/export.js";
import { draftCommand } from "./commands/draft.js";
import { auditCommand } from "./commands/audit.js";
import { reviseCommand } from "./commands/revise.js";
import { agentCommand } from "./commands/agent.js";
import { planCommand } from "./commands/plan.js";
import { composeCommand } from "./commands/compose.js";
import { genreCommand } from "./commands/genre.js";
import { updateCommand } from "./commands/update.js";
import { detectCommand } from "./commands/detect.js";
import { styleCommand } from "./commands/style.js";
import { analyticsCommand } from "./commands/analytics.js";
import { importCommand } from "./commands/import.js";
import { fanficCommand } from "./commands/fanfic.js";
import { studioCommand } from "./commands/studio.js";
import { consolidateCommand } from "./commands/consolidate.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command();

program
  .name("inkos")
  .description("InkOS — Multi-agent novel production system")
  .version(version);

program.addCommand(initCommand);
program.addCommand(configCommand);
program.addCommand(bookCommand);
program.addCommand(writeCommand);
program.addCommand(reviewCommand);
program.addCommand(statusCommand);
program.addCommand(radarCommand);
program.addCommand(upCommand);
program.addCommand(downCommand);
program.addCommand(doctorCommand);
program.addCommand(exportCommand);
program.addCommand(draftCommand);
program.addCommand(auditCommand);
program.addCommand(reviseCommand);
program.addCommand(agentCommand);
program.addCommand(planCommand);
program.addCommand(composeCommand);
program.addCommand(genreCommand);
program.addCommand(updateCommand);
program.addCommand(detectCommand);
program.addCommand(styleCommand);
program.addCommand(analyticsCommand);
program.addCommand(importCommand);
program.addCommand(fanficCommand);
program.addCommand(studioCommand);
program.addCommand(consolidateCommand);

program.parse();
