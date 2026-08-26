import { z } from "zod";

export const XQUIK_RADAR_CATEGORIES = [
  "general",
  "tech",
  "dev",
  "science",
  "culture",
  "politics",
  "business",
  "entertainment",
] as const;

export const XQUIK_RADAR_REGIONS = [
  "global",
  "US",
  "GB",
  "TR",
  "ES",
  "DE",
  "FR",
  "JP",
  "IN",
  "BR",
  "CA",
  "MX",
] as const;

export const XQUIK_RADAR_SOURCES = [
  "github",
  "google_trends",
  "hacker_news",
  "polymarket",
  "reddit",
  "trustmrr",
  "wikipedia",
] as const;

export const XquikRadarConfigSchema = z.object({
  enabled: z.boolean().default(false),
  apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default("XQUIK_API_KEY"),
  category: z.enum(XQUIK_RADAR_CATEGORIES).default("entertainment"),
  region: z.enum(XQUIK_RADAR_REGIONS).default("global"),
  hours: z.number().int().min(1).max(72).default(24),
  limit: z.number().int().min(1).max(100).default(30),
  source: z.enum(XQUIK_RADAR_SOURCES).optional(),
});

export const RadarConfigSchema = z.object({
  xquik: XquikRadarConfigSchema.optional(),
}).optional();

export type XquikRadarCategory = typeof XQUIK_RADAR_CATEGORIES[number];
export type XquikRadarRegion = typeof XQUIK_RADAR_REGIONS[number];
export type XquikRadarSourceName = typeof XQUIK_RADAR_SOURCES[number];
export type XquikRadarConfig = z.infer<typeof XquikRadarConfigSchema>;
export type RadarConfig = z.infer<typeof RadarConfigSchema>;
