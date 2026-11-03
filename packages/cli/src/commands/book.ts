import { Command } from "commander";
import { access, readFile, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import {
  createBookFoundationTool,
  WritingLanguageSchema,
  defaultChapterLength,
  deriveBookIdFromTitle,
  executeExplicitCapabilityTool,
  PlatformSchema,
  PipelineRunner,
  StateManager,
  workDirectory,
  type BookConfig,
} from "@actalk/inkos-core";
import {
  formatBookBackupCreated,
  formatBookBackupListEmpty,
  formatBookCreateCreated,
  formatBookCreateCreating,
  formatBookCreateFoundationReady,
  formatBookCreateLocation,
  formatBookCreateNextStep,
  formatBookRestoreDone,
  resolveCliLanguage,
} from "../localization.js";
import { createBookBackup, listBookBackups, restoreBookBackup } from "../book-backup.js";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, log, logError, resolveCliProfileSkills } from "../utils.js";

export const bookCommand = new Command("book")
  .description("Manage books");

bookCommand
  .command("create")
  .description("Create a new book with AI-generated foundation")
  .requiredOption("--title <title>", "Book title")
  .option("--genre <genre>", "Genre", "xuanhuan")
  .option("--platform <platform>", "Target platform", "tomato")
  .option("--target-chapters <n>", "Target chapter count", "200")
  .option("--chapter-words <n>", "Target chapter length in the book language")
  .option("--brief <path>", "Path to creative brief file (.md/.txt) — Architect builds from your ideas instead of generating from scratch")
  .option("--lang <language>", "Writing language: zh (Chinese), en (English), or ru (Russian). Defaults from the project.")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();

      const bookId = deriveBookIdFromTitle(opts.title) || `book-${Date.now().toString(36)}`;

      const workDir = workDirectory(root, bookId);
      const bookDir = join(workDir, "source");
      try {
        await access(bookDir);
        const state = new StateManager(root);
        if (await state.isCompleteBookDirectory(bookDir)) {
          throw new Error(`Book "${bookId}" already exists as a Work. Use a different title or delete the existing book first.`);
        }
        await rm(workDir, { recursive: true, force: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }

      const config = await loadConfig();
      const now = new Date().toISOString();
      const writingLanguage = WritingLanguageSchema.parse(opts.lang ?? config.language);
      const book: BookConfig = {
        id: bookId,
        title: opts.title,
        platform: PlatformSchema.parse(opts.platform ?? "other"),
        genre: opts.genre,
        status: "outlining",
        targetChapters: parseInt(opts.targetChapters, 10),
        chapterWordCount: opts.chapterWords ? parseInt(opts.chapterWords, 10)
          : writingLanguage === "ru" ? defaultChapterLength(writingLanguage) : 3000,
        language: writingLanguage,
        createdAt: now,
        updatedAt: now,
      };
      const language = resolveCliLanguage(book.language);

      if (!opts.json) log(formatBookCreateCreating(language, book.title, book.genre, book.platform));

      const brief = opts.brief
        ? await readFile(resolve(opts.brief), "utf-8")
        : undefined;

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, { externalContext: brief }));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel");

      await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "create_book", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createBookFoundationTool(pipeline, {
          language: book.language,
          actionPayload: {
            createBook: {
              title: book.title,
              genre: book.genre,
              platform: book.platform,
              language: book.language,
              targetChapters: book.targetChapters,
              chapterWordCount: book.chapterWordCount,
            },
          },
          workerSkills: () => activatedSkills,
        }),
        parameters: {
          instruction: brief?.trim() || `Create ${book.title}`,
          title: book.title,
          genre: book.genre,
          platform: book.platform,
          language: book.language,
          targetChapters: book.targetChapters,
          chapterWordCount: book.chapterWordCount,
        },
      });

      if (opts.json) {
        log(JSON.stringify({
          bookId,
          title: book.title,
          genre: book.genre,
          platform: book.platform,
          location: `works/${bookId}/source/`,
          nextStep: `inkos write next ${bookId}`,
        }, null, 2));
      } else {
        log(formatBookCreateCreated(language, bookId));
        log(formatBookCreateLocation(language, bookId));
        log(formatBookCreateFoundationReady(language));
        log("");
        log(formatBookCreateNextStep(language, bookId));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to create book: ${e}`);
      }
      process.exit(1);
    }
  });

bookCommand
  .command("update")
  .description("Update book settings")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--chapter-words <n>", "Words per chapter")
  .option("--target-chapters <n>", "Target chapter count")
  .option("--status <status>", "Book status (outlining/active/paused/completed)")
  .option("--lang <language>", "Writing language: zh, en, or ru")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);

      const updates: Record<string, unknown> = {};
      if (opts.chapterWords) updates.chapterWordCount = parseInt(opts.chapterWords, 10);
      if (opts.targetChapters) updates.targetChapters = parseInt(opts.targetChapters, 10);
      if (opts.status) updates.status = opts.status;
      if (opts.lang) updates.language = WritingLanguageSchema.parse(opts.lang);

      if (Object.keys(updates).length === 0) {
        if (opts.json) {
          log(JSON.stringify(book, null, 2));
        } else {
          log(`Book: ${book.title} (${bookId})`);
          log(`  Words/chapter: ${book.chapterWordCount}`);
          log(`  Target chapters: ${book.targetChapters}`);
          log(`  Status: ${book.status}`);
          log(`  Genre: ${book.genre} | Platform: ${book.platform}`);
        }
        return;
      }

      const updated: BookConfig = {
        ...book,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      await state.saveBookConfig(bookId, updated);

      if (opts.json) {
        log(JSON.stringify(updated, null, 2));
      } else {
        for (const [key, value] of Object.entries(updates)) {
          log(`  ${key}: ${(book as Record<string, unknown>)[key]} → ${value}`);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to update book: ${e}`);
      }
      process.exit(1);
    }
  });

bookCommand
  .command("list")
  .description("List all books")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const state = new StateManager(root);
      const bookIds = await state.listBooks();

      if (bookIds.length === 0) {
        if (opts.json) {
          log(JSON.stringify({ books: [] }));
        } else {
          log("No books found. Create one with: inkos book create --title '...'");
        }
        return;
      }

      const books = [];
      for (const id of bookIds) {
        const book = await state.loadBookConfig(id);
        const nextChapter = await state.getNextChapterNumber(id);
        const info = {
          id,
          title: book.title,
          genre: book.genre,
          platform: book.platform,
          status: book.status,
          chapters: nextChapter - 1,
        };
        books.push(info);
        if (!opts.json) {
          log(`  ${id} | ${book.title} | ${book.genre}/${book.platform} | ${book.status} | chapters: ${nextChapter - 1}`);
        }
      }

      if (opts.json) {
        log(JSON.stringify({ books }, null, 2));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to list books: ${e}`);
      }
      process.exit(1);
    }
  });

bookCommand
  .command("delete")
  .description("Delete a book and all its chapters, truth files, and snapshots")
  .argument("<book-id>", "Book ID to delete")
  .option("--force", "Skip confirmation prompt")
  .option("--json", "Output JSON")
  .action(async (bookId: string, opts) => {
    try {
      const root = findProjectRoot();
      const state = new StateManager(root);

      const allBooks = await state.listBooks();
      if (!allBooks.includes(bookId)) {
        throw new Error(`Book "${bookId}" not found. Available: ${allBooks.join(", ") || "(none)"}`);
      }

      const book = await state.loadBookConfig(bookId);
      const index = await state.loadChapterIndex(bookId);

      if (!opts.force) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(
            `Delete "${book.title}" (${bookId})? This will remove ${index.length} chapter(s) and all data. (y/N) `,
            resolve,
          );
        });
        rl.close();
        if (answer.toLowerCase() !== "y") {
          log("Cancelled.");
          return;
        }
      }

      await rm(workDirectory(root, bookId), { recursive: true, force: true });

      if (opts.json) {
        log(JSON.stringify({ deleted: bookId, chapters: index.length }));
      } else {
        log(`Deleted "${book.title}" (${bookId}): ${index.length} chapter(s) removed.`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to delete book: ${e}`);
      }
      process.exit(1);
    }
  });

bookCommand
  .command("backup")
  .description("Snapshot the whole book directory into .inkos/backups/<book-id>/ (or list backups with --list)")
  .argument("<book-id>", "Book ID")
  .option("--list", "List existing backups instead of creating one")
  .option("--json", "Output JSON")
  .action(async (bookId: string, opts) => {
    try {
      const root = findProjectRoot();
      // Backups must also work on broken books (e.g. corrupted book.json),
      // so the output language follows the environment, not the book config.
      const language = resolveCliLanguage();

      if (opts.list) {
        const backups = await listBookBackups(root, bookId);
        if (opts.json) {
          log(JSON.stringify({ bookId, backups }, null, 2));
        } else if (backups.length === 0) {
          log(formatBookBackupListEmpty(language, bookId));
        } else {
          for (const backup of backups) {
            log(`  ${backup.id}  ${backup.createdAt}`);
          }
        }
        return;
      }

      const result = await createBookBackup(root, bookId);
      if (opts.json) {
        log(JSON.stringify({ bookId, backupId: result.backupId }, null, 2));
      } else {
        log(formatBookBackupCreated(language, bookId, result.backupId));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to back up book: ${e}`);
      }
      process.exit(1);
    }
  });

bookCommand
  .command("restore")
  .description("Restore a whole-book backup (the current book state is automatically backed up first)")
  .argument("<book-id>", "Book ID")
  .argument("<backup-id>", "Backup ID, see `inkos book backup <book-id> --list`")
  .option("--json", "Output JSON")
  .action(async (bookId: string, backupId: string, opts) => {
    try {
      const root = findProjectRoot();
      const language = resolveCliLanguage();

      const result = await restoreBookBackup(root, bookId, backupId);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(formatBookRestoreDone(language, {
          bookId,
          backupId: result.restoredFrom,
          preRestoreBackupId: result.preRestoreBackupId,
        }));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to restore book: ${e}`);
      }
      process.exit(1);
    }
  });
