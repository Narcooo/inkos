import { readFile } from "node:fs/promises";

/**
 * Lee un archivo con un valor por defecto si no existe.
 *
 * Función pura de utilidad, usada por BaseAgent (agents) y PipelineRunner
 * para evitar duplicar la lógica try/catch de lectura segura.
 */
export async function readFileSafe(path: string, fallback = "(文件不存在)"): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return fallback;
  }
}
