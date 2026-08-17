import { Command } from "commander";
import {
  activatedSkillIds,
  createLLMTranslationModel,
  createTranslationProjectFromFile,
  loadAvailableAgentSkills,
  resolveProductionSkillActivations,
  runTranslationProject,
  writeTranslationExport,
} from "@actalk/inkos-core";
import { createClient, findProjectRoot, loadConfig, log, logError } from "../utils.js";

export const translateCommand = new Command("translate")
  .description("Translate and localize novels/scripts across languages");

translateCommand
  .command("init")
  .description("Create a translation project from EPUB/PDF/TXT/Markdown")
  .requiredOption("--from <path>", "Source file path")
  .requiredOption("--source <language>", "Source language, e.g. ja, en, zh, ko, auto")
  .requiredOption("--target <language>", "Target language, e.g. zh, en, ja")
  .option("--title <title>", "Override translation title")
  .option("--segment-max-chars <n>", "Max chars per segment before splitting long paragraphs", parseInt)
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const result = await createTranslationProjectFromFile(root, {
        filePath: opts.from,
        sourceLanguage: opts.source,
        targetLanguage: opts.target,
        title: opts.title,
        segmentMaxChars: opts.segmentMaxChars,
      });
      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(`Translation project created: ${result.manifest.id}`);
        log(`Title: ${result.manifest.title}`);
        log(`Chapters: ${result.manifest.chapters.length}`);
        log(`Manifest: ${result.manifestPath}`);
      }
    } catch (error) {
      fail("Failed to create translation project", error, opts.json);
    }
  });

translateCommand
  .command("run")
  .description("Translate pending segments and write a review report")
  .argument("<project-id>", "Translation project ID under translations/")
  .option("--batch-size <n>", "Segments per model call", parseInt)
  .option("--max-tokens <n>", "Max output tokens per translation batch", parseInt)
  .option("--json", "Output JSON")
  .action(async (projectId: string, opts) => {
    try {
      const root = findProjectRoot();
      const config = await loadConfig({ requireApiKey: true, projectRoot: root });
      const configuredSkills = await loadAvailableAgentSkills({ projectRoot: root });
      const activatedSkills = resolveProductionSkillActivations(configuredSkills.skills, "translation");
      const model = createLLMTranslationModel({
        client: createClient(config),
        model: config.llm.model,
        maxTokens: opts.maxTokens,
        activatedSkills,
      });
      const result = await runTranslationProject(root, projectId, {
        model,
        batchSize: opts.batchSize,
      });
      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(`Skills: ${activatedSkillIds(activatedSkills).join(", ")}`);
        log(`Translated segments: ${result.translatedSegments}`);
        log(`Reviewed chapters: ${result.reviewedChapters}`);
        log(`Report: ${result.reportPath}`);
      }
    } catch (error) {
      fail("Translation run failed", error, opts.json);
    }
  });

translateCommand
  .command("export")
  .description("Export translated text to Markdown/TXT/EPUB")
  .argument("<project-id>", "Translation project ID under translations/")
  .option("--format <format>", "Output format: md, txt, epub", "md")
  .option("--output <path>", "Output file path")
  .option("--json", "Output JSON")
  .action(async (projectId: string, opts) => {
    try {
      const root = findProjectRoot();
      const result = await writeTranslationExport(root, projectId, {
        format: opts.format,
        outputPath: opts.output,
      });
      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(`Exported ${result.chaptersExported} chapter(s)`);
        log(`Output: ${result.outputPath}`);
      }
    } catch (error) {
      fail("Translation export failed", error, opts.json);
    }
  });

function fail(prefix: string, error: unknown, json: boolean): never {
  if (json) {
    log(JSON.stringify({ error: String(error) }));
  } else {
    logError(`${prefix}: ${error}`);
  }
  process.exit(1);
}
