import type { WritingLanguage } from "../models/book.js";

/** Infer a supported writing language from a brief by its dominant script. */
export function inferLanguage(text?: string | null): WritingLanguage {
  const source = text ?? "";
  const han = (source.match(/\p{Script=Han}/gu) ?? []).length;
  const latin = (source.match(/\p{Script=Latin}/gu) ?? []).length;
  const cyrillic = (source.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  if (cyrillic > latin && cyrillic > han) return "ru";
  if (latin > 0 && han * 4 < latin) return "en";
  return "zh";
}

/** Constrain human-readable output without changing machine-readable keys or IDs. */
export const RUSSIAN_OUTPUT_INSTRUCTION =
  "Пишите весь текст для автора на русском языке. Сохраняйте написание имён, факты, хронологию и причинно-следственные связи, если автор явно не просит их изменить. Ключи схемы, идентификаторы и допустимые значения полей сохраняйте без перевода.";
