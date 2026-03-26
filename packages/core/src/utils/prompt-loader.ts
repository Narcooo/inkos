/**
 * [R3] Sync Prompt Template Loader
 *
 * Carga plantillas de prompts desde disco de forma sincrona.
 * Usa readFileSync + memoria cache para evitar I/O repetido
 * y mantener la API de buildWriterSystemPrompt sincrona.
 *
 * Las plantillas usan marcadores {{variable}} para interpolacion.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolver la ruta del directorio prompts/ relativa a este archivo
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "..", "prompts");

// Cache en memoria para evitar lecturas repetidas al disco
const cache = new Map<string, string>();

/**
 * Carga un template de prompt desde el directorio prompts/ de forma sincrona.
 * Retorna null si el archivo no existe (permite fallback al contenido inline).
 */
export function loadPromptTemplateSync(
  filename: string,
  vars?: Record<string, string | number>,
): string | null {
  let content = cache.get(filename);
  if (content === undefined) {
    const filePath = join(PROMPTS_DIR, filename);
    if (!existsSync(filePath)) {
      // No arrojamos error: el caller usara el fallback inline
      return null;
    }
    content = readFileSync(filePath, "utf-8");
    cache.set(filename, content);
  }

  // Interpolar variables {{key}} si se proporcionan
  if (vars && content) {
    let result = content;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(`{{${key}}}`, String(value));
    }
    return result;
  }

  return content;
}

/**
 * Invalida la cache de templates (util para testing y recarga en caliente).
 */
export function clearPromptCache(): void {
  cache.clear();
}
