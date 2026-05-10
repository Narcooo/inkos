import type { Hono } from "hono";
import {
  getBuiltinGenresDir,
  listAvailableGenres,
  readGenreProfile,
} from "@actalk/inkos-core";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "../errors.js";

interface RegisterGenreRoutesOptions {
  readonly root: string;
}

interface GenreUpsertBody {
  id?: string;
  name?: string;
  language?: string;
  chapterTypes?: string[];
  fatigueWords?: string[];
  numericalSystem?: boolean;
  powerScaling?: boolean;
  eraResearch?: boolean;
  pacingRule?: string;
  satisfactionTypes?: string[];
  auditDimensions?: number[];
  body?: string;
}

function assertSafeGenreId(genreId: string): void {
  if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
    throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
  }
}

function serializeGenreProfile(
  genreId: string,
  profile: GenreUpsertBody | Record<string, unknown>,
  body: string | undefined,
): string {
  return [
    "---",
    `name: ${profile.name ?? genreId}`,
    `id: ${profile.id ?? genreId}`,
    `language: ${profile.language ?? "zh"}`,
    `chapterTypes: ${JSON.stringify(profile.chapterTypes ?? [])}`,
    `fatigueWords: ${JSON.stringify(profile.fatigueWords ?? [])}`,
    `numericalSystem: ${profile.numericalSystem ?? false}`,
    `powerScaling: ${profile.powerScaling ?? false}`,
    `eraResearch: ${profile.eraResearch ?? false}`,
    `pacingRule: "${profile.pacingRule ?? ""}"`,
    `satisfactionTypes: ${JSON.stringify(profile.satisfactionTypes ?? [])}`,
    `auditDimensions: ${JSON.stringify(profile.auditDimensions ?? [])}`,
    "---",
    "",
    body ?? "",
  ].join("\n");
}

export function registerGenreRoutes(app: Hono, options: RegisterGenreRoutesOptions): void {
  app.get("/api/v1/genres", async (c) => {
    const rawGenres = await listAvailableGenres(options.root);
    const genres = await Promise.all(
      rawGenres.map(async (genre) => {
        try {
          const { profile } = await readGenreProfile(options.root, genre.id);
          return { ...genre, language: profile.language ?? "zh" };
        } catch {
          return { ...genre, language: "zh" };
        }
      }),
    );
    return c.json({ genres });
  });

  app.get("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    try {
      const { profile, body } = await readGenreProfile(options.root, genreId);
      return c.json({ profile, body });
    } catch (e) {
      return c.json({ error: String(e) }, 404);
    }
  });

  app.post("/api/v1/genres/:id/copy", async (c) => {
    const genreId = c.req.param("id");
    assertSafeGenreId(genreId);
    try {
      const builtinDir = getBuiltinGenresDir();
      const projectGenresDir = join(options.root, "genres");
      await mkdir(projectGenresDir, { recursive: true });
      await copyFile(join(builtinDir, `${genreId}.md`), join(projectGenresDir, `${genreId}.md`));
      return c.json({ ok: true, path: `genres/${genreId}.md` });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/genres/create", async (c) => {
    const body = await c.req.json<GenreUpsertBody & { id: string; name: string }>();

    if (!body.id || !body.name) {
      return c.json({ error: "id and name are required" }, 400);
    }
    assertSafeGenreId(body.id);

    const genresDir = join(options.root, "genres");
    await mkdir(genresDir, { recursive: true });
    await writeFile(join(genresDir, `${body.id}.md`), serializeGenreProfile(body.id, body, body.body), "utf-8");
    return c.json({ ok: true, id: body.id });
  });

  app.put("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    assertSafeGenreId(genreId);

    const body = await c.req.json<{ profile: Record<string, unknown>; body: string }>();
    const genresDir = join(options.root, "genres");
    await mkdir(genresDir, { recursive: true });
    await writeFile(join(genresDir, `${genreId}.md`), serializeGenreProfile(genreId, body.profile, body.body), "utf-8");
    return c.json({ ok: true, id: genreId });
  });

  app.delete("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    assertSafeGenreId(genreId);

    const filePath = join(options.root, "genres", `${genreId}.md`);
    try {
      await rm(filePath);
      return c.json({ ok: true, id: genreId });
    } catch {
      return c.json({ error: `Genre "${genreId}" not found in project` }, 404);
    }
  });
}
