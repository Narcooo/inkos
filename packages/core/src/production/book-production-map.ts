import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ProductionVolume {
  readonly volumeId: string;
  readonly volumeNumber: number;
  readonly title: string;
  readonly startChapter: number;
  readonly endChapter: number;
  readonly chapterCount: number;
}

export interface BookProductionMap {
  readonly schemaVersion: "1.0";
  readonly bookId: string;
  readonly authorityBookId: string;
  readonly title: string;
  readonly totalChapters: number;
  readonly volumes: ReadonlyArray<ProductionVolume>;
}

export type ProductionMode = "current-volume" | "full-book";

export interface ProductionScope {
  readonly complete: boolean;
  readonly startChapter: number;
  readonly targetChapter: number;
  readonly currentVolume: ProductionVolume;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BOOK_PRODUCTION_MAP_INVALID: expected an object");
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`BOOK_PRODUCTION_MAP_INVALID: ${label}`);
  }
  return Number(value);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`BOOK_PRODUCTION_MAP_INVALID: ${label}`);
  }
  return value;
}

export function parseBookProductionMap(value: unknown, expectedBookId?: string): BookProductionMap {
  const raw = record(value);
  if (raw.schema_version !== "1.0") {
    throw new Error("BOOK_PRODUCTION_MAP_INVALID: schema_version");
  }
  const bookId = text(raw.book_id, "book_id");
  if (expectedBookId && bookId !== expectedBookId) {
    throw new Error(`BOOK_PRODUCTION_MAP_BOOK_ID_MISMATCH: expected ${expectedBookId}`);
  }
  const totalChapters = integer(raw.total_chapters, "total_chapters");
  if (!Array.isArray(raw.volumes) || raw.volumes.length === 0) {
    throw new Error("BOOK_PRODUCTION_MAP_INVALID: volumes");
  }
  const rawVolumes = raw.volumes;

  const volumes = rawVolumes.map((item, index): ProductionVolume => {
    const volume = record(item);
    const volumeNumber = integer(volume.volume_number, `volumes[${index}].volume_number`);
    const startChapter = integer(volume.start_chapter, `volumes[${index}].start_chapter`);
    const endChapter = integer(volume.end_chapter, `volumes[${index}].end_chapter`);
    const chapterCount = integer(volume.chapter_count, `volumes[${index}].chapter_count`);
    const expectedId = `volume-${String(index + 1).padStart(3, "0")}`;
    if (volumeNumber !== index + 1 || volume.volume_id !== expectedId) {
      throw new Error(`BOOK_PRODUCTION_MAP_INVALID: volume sequence at ${index}`);
    }
    if (endChapter - startChapter + 1 !== chapterCount) {
      throw new Error(`BOOK_PRODUCTION_MAP_INVALID: chapter_count at ${expectedId}`);
    }
    const expectedStart = index === 0 ? 1 : Number((rawVolumes[index - 1] as Record<string, unknown>).end_chapter) + 1;
    if (startChapter !== expectedStart) {
      throw new Error(`BOOK_PRODUCTION_MAP_INVALID: gap or overlap at ${expectedId}`);
    }
    return {
      volumeId: expectedId,
      volumeNumber,
      title: text(volume.title, `volumes[${index}].title`),
      startChapter,
      endChapter,
      chapterCount,
    };
  });

  if (volumes.at(-1)?.endChapter !== totalChapters) {
    throw new Error("BOOK_PRODUCTION_MAP_INVALID: final chapter mismatch");
  }

  return {
    schemaVersion: "1.0",
    bookId,
    authorityBookId: text(raw.authority_book_id, "authority_book_id"),
    title: text(raw.title, "title"),
    totalChapters,
    volumes,
  };
}

export async function loadBookProductionMap(projectRoot: string, bookId: string): Promise<BookProductionMap | null> {
  const path = join(projectRoot, "books", bookId, "story", "outline", "book-production-map.json");
  try {
    return parseBookProductionMap(JSON.parse(await readFile(path, "utf-8")), bookId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function resolveProductionScope(
  map: BookProductionMap,
  nextChapter: number,
  mode: ProductionMode,
): ProductionScope {
  const currentVolume = map.volumes.find((volume) =>
    nextChapter >= volume.startChapter && nextChapter <= volume.endChapter,
  ) ?? map.volumes.at(-1)!;
  return {
    complete: nextChapter > map.totalChapters,
    startChapter: nextChapter,
    targetChapter: mode === "current-volume" ? currentVolume.endChapter : map.totalChapters,
    currentVolume,
  };
}
