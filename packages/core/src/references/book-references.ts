import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MaterialAsset } from "../materials/ingest.js";
import { assertSafeBookId } from "../utils/book-id.js";
import { safeChildPath } from "../utils/path-safety.js";

export interface BookReferenceBinding {
  readonly materialId: string;
  readonly uses: ReadonlyArray<string>;
  readonly note?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BookReferenceManifest {
  readonly version: 1;
  readonly bookId: string;
  readonly bindings: ReadonlyArray<BookReferenceBinding>;
}

export interface BindBookReferenceInput {
  readonly materialId: string;
  readonly uses: ReadonlyArray<string>;
  readonly note?: string;
}

export interface BookReferenceDeps {
  readonly now?: () => Date;
}

export interface ResolvedBookReference extends BookReferenceBinding {
  readonly available: boolean;
  readonly title?: string;
  readonly asset?: MaterialAsset;
  readonly error?: string;
}

export interface BookReferenceList {
  readonly manifest: BookReferenceManifest;
  readonly references: ReadonlyArray<ResolvedBookReference>;
}

const MANIFEST_FILE = "reference_bindings.json";
const MAX_USES = 12;
const MAX_USE_LENGTH = 120;
const MAX_NOTE_LENGTH = 2_000;

export async function bindBookReference(
  projectRoot: string,
  bookId: string,
  input: BindBookReferenceInput,
  deps: BookReferenceDeps = {},
): Promise<BookReferenceManifest> {
  const safeBookId = assertSafeBookId(bookId);
  await assertBookExists(projectRoot, safeBookId);
  const materialId = assertMaterialId(input.materialId);
  await loadMaterialAsset(projectRoot, materialId);
  const uses = normalizeUses(input.uses);
  const note = normalizeNote(input.note);
  const current = await loadBookReferenceManifest(projectRoot, safeBookId);
  const now = (deps.now?.() ?? new Date()).toISOString();
  const existing = current.bindings.find((binding) => binding.materialId === materialId);
  const binding: BookReferenceBinding = {
    materialId,
    uses,
    ...(note ? { note } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const next: BookReferenceManifest = {
    version: 1,
    bookId: safeBookId,
    bindings: [
      ...current.bindings.filter((entry) => entry.materialId !== materialId),
      binding,
    ],
  };
  await writeManifestAtomic(projectRoot, next);
  return next;
}

export async function unbindBookReference(
  projectRoot: string,
  bookId: string,
  materialIdInput: string,
): Promise<{ readonly removed: boolean; readonly manifest: BookReferenceManifest }> {
  const safeBookId = assertSafeBookId(bookId);
  await assertBookExists(projectRoot, safeBookId);
  const materialId = assertMaterialId(materialIdInput);
  const current = await loadBookReferenceManifest(projectRoot, safeBookId);
  const bindings = current.bindings.filter((binding) => binding.materialId !== materialId);
  const removed = bindings.length !== current.bindings.length;
  const manifest = { ...current, bindings } satisfies BookReferenceManifest;
  if (removed) await writeManifestAtomic(projectRoot, manifest);
  return { removed, manifest };
}

export async function listBookReferences(projectRoot: string, bookId: string): Promise<BookReferenceList> {
  const safeBookId = assertSafeBookId(bookId);
  await assertBookExists(projectRoot, safeBookId);
  const manifest = await loadBookReferenceManifest(projectRoot, safeBookId);
  const references = await Promise.all(manifest.bindings.map(async (binding): Promise<ResolvedBookReference> => {
    try {
      const asset = await loadMaterialAsset(projectRoot, binding.materialId);
      return { ...binding, available: true, title: asset.title, asset };
    } catch (error) {
      return {
        ...binding,
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));
  return { manifest, references };
}

export async function loadBookReferenceManifest(
  projectRoot: string,
  bookId: string,
): Promise<BookReferenceManifest> {
  const safeBookId = assertSafeBookId(bookId);
  const path = referenceManifestPath(projectRoot, safeBookId);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if (isMissingFile(error)) {
      return { version: 1, bookId: safeBookId, bindings: [] };
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<BookReferenceManifest>;
  if (parsed.version !== 1 || parsed.bookId !== safeBookId || !Array.isArray(parsed.bindings)) {
    throw new Error(`Invalid book reference manifest: ${path}`);
  }
  return {
    version: 1,
    bookId: safeBookId,
    bindings: parsed.bindings.map(parseBinding),
  };
}

export async function loadMaterialAsset(projectRoot: string, materialIdInput: string): Promise<MaterialAsset> {
  const materialId = assertMaterialId(materialIdInput);
  const materialsDir = join(projectRoot, ".inkos", "materials");
  const manifestPath = safeChildPath(materialsDir, `${materialId}.json`);
  const parsed = JSON.parse(await readFile(manifestPath, "utf-8")) as Partial<MaterialAsset>;
  if (
    parsed.id !== materialId
    || typeof parsed.title !== "string"
    || typeof parsed.markdownPath !== "string"
    || typeof parsed.manifestPath !== "string"
  ) {
    throw new Error(`Invalid material manifest: ${manifestPath}`);
  }
  const expectedMarkdownPath = safeChildPath(materialsDir, `${materialId}.md`);
  const resolvedMarkdownPath = safeChildPath(projectRoot, parsed.markdownPath);
  if (resolvedMarkdownPath !== expectedMarkdownPath) {
    throw new Error(`Material markdown path does not match its asset id: ${manifestPath}`);
  }
  return parsed as MaterialAsset;
}

function parseBinding(value: unknown): BookReferenceBinding {
  if (!value || typeof value !== "object") throw new Error("Invalid book reference binding.");
  const binding = value as Partial<BookReferenceBinding>;
  const materialId = assertMaterialId(binding.materialId ?? "");
  const uses = normalizeUses(binding.uses ?? []);
  if (typeof binding.createdAt !== "string" || typeof binding.updatedAt !== "string") {
    throw new Error(`Invalid timestamps for book reference binding ${materialId}.`);
  }
  const note = normalizeNote(binding.note);
  return {
    materialId,
    uses,
    ...(note ? { note } : {}),
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

function normalizeUses(values: ReadonlyArray<string>): string[] {
  if (!Array.isArray(values)) throw new Error("Reference uses must be an array.");
  const uses: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") throw new Error("Reference uses must contain only text.");
    const use = value.trim();
    if (!use || seen.has(use)) continue;
    if (use.length > MAX_USE_LENGTH) {
      throw new Error(`Reference use is too long (${use.length}/${MAX_USE_LENGTH}).`);
    }
    seen.add(use);
    uses.push(use);
  }
  if (uses.length === 0) throw new Error("At least one reference use is required.");
  if (uses.length > MAX_USES) throw new Error(`Too many reference uses (${uses.length}/${MAX_USES}).`);
  return uses;
}

function normalizeNote(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Reference note must be text.");
  const note = value.trim();
  if (!note) return undefined;
  if (note.length > MAX_NOTE_LENGTH) {
    throw new Error(`Reference note is too long (${note.length}/${MAX_NOTE_LENGTH}).`);
  }
  return note;
}

function assertMaterialId(value: string): string {
  const materialId = value.trim();
  if (
    !materialId
    || materialId.length > 240
    || materialId === "."
    || materialId === ".."
    || materialId.includes("..")
    || /[/\\\0]/u.test(materialId)
  ) {
    throw new Error(`Invalid materialId: ${JSON.stringify(value)}`);
  }
  return materialId;
}

function referenceManifestPath(projectRoot: string, bookId: string): string {
  return join(projectRoot, "books", bookId, "story", MANIFEST_FILE);
}

async function assertBookExists(projectRoot: string, bookId: string): Promise<void> {
  const bookDir = join(projectRoot, "books", bookId);
  try {
    if (!(await stat(bookDir)).isDirectory()) throw new Error(`Book not found: ${bookId}`);
  } catch (error) {
    if (isMissingFile(error)) throw new Error(`Book not found: ${bookId}`);
    throw error;
  }
}

async function writeManifestAtomic(projectRoot: string, manifest: BookReferenceManifest): Promise<void> {
  const path = referenceManifestPath(projectRoot, manifest.bookId);
  await mkdir(join(projectRoot, "books", manifest.bookId, "story"), { recursive: true });
  const tempPath = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT";
}
