/**
 * [R8] Golden Output Snapshot Utility
 *
 * Captura y compara salidas de pipeline contra snapshots dorados.
 * Permite detectar regresiones en la cadena completa de generacion.
 *
 * Uso:
 *   - Modo capture: genera nuevos snapshots desde una ejecucion de pipeline
 *   - Modo compare: verifica que la salida actual coincide con el snapshot
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

// Directorio de fixtures relativo a este archivo
const FIXTURES_DIR = join(dirname(new URL(import.meta.url).pathname), "..", "__fixtures__", "golden");

export interface GoldenSnapshot {
  /** Nombre identificador del escenario */
  readonly scenario: string;
  /** Timestamp de captura del snapshot */
  readonly capturedAt: string;
  /** Version del pipeline que genero el snapshot */
  readonly pipelineVersion: string;
  /** Archivos generados como parte del resultado */
  readonly files: Record<string, string>;
  /** Metadatos del resultado de pipeline */
  readonly metadata: Record<string, unknown>;
}

/**
 * Captura un snapshot dorado de los archivos generados por el pipeline.
 */
export async function captureGoldenSnapshot(
  scenario: string,
  files: Record<string, string>,
  metadata: Record<string, unknown> = {},
): Promise<GoldenSnapshot> {
  const snapshot: GoldenSnapshot = {
    scenario,
    capturedAt: new Date().toISOString(),
    pipelineVersion: "v2-layered",
    files,
    metadata,
  };

  const dir = resolveFixturesDir();
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${scenario}.json`);
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf-8");

  return snapshot;
}

/**
 * Carga un snapshot dorado previamente capturado.
 */
export async function loadGoldenSnapshot(
  scenario: string,
  fixturesDir?: string,
): Promise<GoldenSnapshot | null> {
  const dir = fixturesDir ?? resolveFixturesDir();
  const filePath = join(dir, `${scenario}.json`);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as GoldenSnapshot;
  } catch {
    return null;
  }
}

/**
 * Compara archivos generados contra un snapshot dorado.
 * Retorna un array vacio si todo coincide, o un array de diffs.
 */
export function compareWithSnapshot(
  snapshot: GoldenSnapshot,
  actualFiles: Record<string, string>,
): GoldenDiff[] {
  const diffs: GoldenDiff[] = [];

  // Verificar archivos que estan en el snapshot
  for (const [filename, expectedContent] of Object.entries(snapshot.files)) {
    const actualContent = actualFiles[filename];
    if (actualContent === undefined) {
      diffs.push({ filename, type: "missing", expected: expectedContent });
    } else if (normalizeContent(actualContent) !== normalizeContent(expectedContent)) {
      diffs.push({
        filename,
        type: "changed",
        expected: expectedContent,
        actual: actualContent,
      });
    }
  }

  // Verificar archivos nuevos no esperados
  for (const filename of Object.keys(actualFiles)) {
    if (!(filename in snapshot.files)) {
      diffs.push({ filename, type: "unexpected", actual: actualFiles[filename] });
    }
  }

  return diffs;
}

export interface GoldenDiff {
  readonly filename: string;
  readonly type: "missing" | "changed" | "unexpected";
  readonly expected?: string;
  readonly actual?: string;
}

/**
 * Normaliza contenido para comparacion tolerante:
 * - Elimina espacios trailing
 * - Normaliza line endings
 * - Trim final
 */
function normalizeContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/** Resuelve la ruta al directorio de fixtures para Windows */
function resolveFixturesDir(): string {
  // En Windows, import.meta.url produce file:///D:/... que necesita ajuste
  const url = new URL(import.meta.url);
  const filePath = url.pathname.replace(/^\/([A-Z]:)/, "$1");
  return join(dirname(filePath), "..", "__fixtures__", "golden");
}
