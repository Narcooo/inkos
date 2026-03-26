/**
 * Atomic Write Group — garantiza consistencia al escribir múltiples archivos.
 *
 * Estrategia: escribe primero en un directorio temporal, luego renombra
 * (move) cada archivo al destino final. Si cualquier escritura falla,
 * limpia el directorio temporal sin afectar los originales.
 *
 * Esto previene estados inconsistentes cuando el proceso se interrumpe
 * a mitad de un settlement (e.g., character_matrix.md actualizado pero
 * subplot_board.md aún con el valor anterior).
 */

import { writeFile, rename, mkdir, unlink, readdir, rmdir } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import type { Logger } from "./logger.js";

export interface WriteEntry {
  /** Ruta absoluta del archivo destino */
  readonly path: string;
  /** Contenido a escribir */
  readonly content: string;
}

/**
 * Escribe múltiples archivos de forma (cuasi-)atómica.
 *
 * 1. Crea un directorio temporal junto al primer archivo destino.
 * 2. Escribe todos los archivos en el directorio temporal.
 * 3. Renombra (move) cada archivo temporal al destino final.
 * 4. Limpia el directorio temporal.
 *
 * Si el paso 2 falla → los originales no se tocan.
 * Si el paso 3 falla a mitad → se registra warning, algunos archivos
 * pueden haberse movido (mejor que la alternativa de writeFile directo).
 */
export async function atomicWriteGroup(
  writes: readonly WriteEntry[],
  logger?: Logger,
): Promise<void> {
  if (writes.length === 0) return;

  // Usar el directorio del primer archivo como base para el tmp
  const baseDir = dirname(writes[0]!.path);
  const tmpDir = join(baseDir, `.tmp-settlement-${Date.now()}`);

  try {
    // Paso 1: crear directorio temporal
    await mkdir(tmpDir, { recursive: true });

    // Paso 2: escribir todos los archivos en tmp
    const tmpPaths: Array<{ tmp: string; dest: string }> = [];
    for (const entry of writes) {
      if (!entry.content || entry.content.trim().length === 0) continue;
      const tmpPath = join(tmpDir, basename(entry.path));
      await writeFile(tmpPath, entry.content, "utf-8");
      tmpPaths.push({ tmp: tmpPath, dest: entry.path });
    }

    // Paso 3: mover cada archivo tmp al destino
    for (const { tmp, dest } of tmpPaths) {
      // Asegurar que el directorio destino existe
      await mkdir(dirname(dest), { recursive: true });
      try {
        await rename(tmp, dest);
      } catch {
        // rename falla entre filesystems diferentes → fallback a write + unlink
        const { readFile: rf } = await import("node:fs/promises");
        const content = await rf(tmp, "utf-8");
        await writeFile(dest, content, "utf-8");
        await unlink(tmp).catch(() => {});
      }
    }

    // Paso 4: limpiar directorio temporal
    await cleanupTmpDir(tmpDir);
    
    logger?.info(`[atomic-write] ${tmpPaths.length} files written atomically`);
  } catch (error) {
    // Limpieza defensiva del directorio temporal
    try {
      await cleanupTmpDir(tmpDir);
    } catch {
      // Ignorar errores de limpieza
    }
    logger?.error(`[atomic-write] Failed: ${String(error).slice(0, 200)}`);
    throw error;
  }
}

async function cleanupTmpDir(tmpDir: string): Promise<void> {
  try {
    const remaining = await readdir(tmpDir);
    for (const file of remaining) {
      await unlink(join(tmpDir, file)).catch(() => {});
    }
    await rmdir(tmpDir).catch(() => {});
  } catch {
    // El directorio ya fue limpiado o no existe
  }
}
