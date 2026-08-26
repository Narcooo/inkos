import { Command } from "commander";
import { PipelineRunner, createConfiguredRadarSources } from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, log, logError } from "../utils.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export const radarCommand = new Command("radar")
  .description("Market intelligence");

radarCommand
  .command("scan")
  .description("Scan market for opportunities")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const config = await loadConfig();
      const root = findProjectRoot();

      const radarSources = createConfiguredRadarSources(config.radar);
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, { radarSources }));

      if (!opts.json) log("Scanning market...");

      const result = await pipeline.runRadar();

      // Save radar result
      const radarDir = join(root, "radar");
      await mkdir(radarDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filePath = join(radarDir, `scan-${timestamp}.json`);
      await writeFile(
        filePath,
        JSON.stringify(result, null, 2),
        "utf-8",
      );

      if (opts.json) {
        log(JSON.stringify({ ...result, savedTo: filePath }, null, 2));
      } else {
        log(`\nMarket Summary:\n${result.marketSummary}\n`);
        log("Recommendations:");

        for (const rec of result.recommendations) {
          log(`  [${(rec.confidence * 100).toFixed(0)}%] ${rec.platform}/${rec.genre}`);
          log(`    Concept: ${rec.concept}`);
          log(`    Reasoning: ${rec.reasoning}`);
          log(`    Benchmarks: ${rec.benchmarkTitles.join(", ")}`);
          log("");
        }

        log(`Radar result saved to radar/scan-${timestamp}.json`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Radar scan failed: ${e}`);
      }
      process.exit(1);
    }
  });
