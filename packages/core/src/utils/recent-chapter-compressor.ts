/**
 * Recent Chapter Compressor — Representaciones multinivel del capítulo reciente.
 *
 * Provee dos niveles de representación:
 * - level 0 (full): texto completo del capítulo
 * - level 1 (tail): segunda mitad + párrafos finales (ganchos, clímax, estado final)
 */

// === Core Functions ===

/**
 * Level 0: devuelve el texto completo del capítulo (identity function).
 */
export function buildRecentChapterFull(content: string): string {
  return content;
}

/**
 * Level 1: extrae la segunda mitad del capítulo, con énfasis en los
 * párrafos finales donde suelen estar: ganchos, revelaciones, estado final.
 *
 * Heurística:
 * - Toma desde el 50% del texto (por párrafo, no por carácter)
 * - Siempre incluye los últimos 5 párrafos completos
 */
export function buildRecentChapterTail(content: string): string {
  if (!content) return "";

  const paragraphs = splitParagraphs(content);

  if (paragraphs.length <= 6) {
    // Capítulo corto — devuelve completo
    return content;
  }

  // Toma desde el 50% de los párrafos
  const halfIndex = Math.floor(paragraphs.length / 2);
  // Asegura que al menos los últimos 5 párrafos estén incluidos
  const startIndex = Math.min(halfIndex, paragraphs.length - 5);

  const tailParagraphs = paragraphs.slice(startIndex);

  return `[…前文省略…]\n\n${tailParagraphs.join("\n\n")}`;
}

// === Internal Helpers ===

/**
 * Divide el contenido en párrafos, respetando párrafos vacíos como separadores.
 * Filtra líneas puramente vacías.
 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
