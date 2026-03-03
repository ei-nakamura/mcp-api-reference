import { z } from "zod";

export const CrawlConfigSchema = z.object({
  startUrl: z.string().url(),
  includePatterns: z.array(z.string()).default([]),
  excludePatterns: z.array(z.string()).default([]),
  maxPages: z.number().int().positive().default(500),
  delayMs: z.number().int().nonnegative().default(500),
});

export type CrawlConfig = z.infer<typeof CrawlConfigSchema>;

export const ParserConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("preset") }),
  z.object({
    type: z.literal("generic"),
    selectors: z.object({
      endpointContainer: z.string(),
      method: z.string().optional(),
      path: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      parameters: z.string().optional(),
      responseFields: z.string().optional(),
    }),
  }),
]);

export type ParserConfig = z.infer<typeof ParserConfigSchema>;

export const SiteConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  baseUrl: z.string().url(),
  crawl: CrawlConfigSchema,
  parser: ParserConfigSchema,
});

export type SiteConfig = z.infer<typeof SiteConfigSchema>;

export interface PresetConfig extends SiteConfig {
  presetModule: string;
}

export interface ServerOptions {
  refreshTarget?: string;
  configPath?: string;
  cacheDir?: string;
  ttlDays?: number;
  logLevel?: "debug" | "info" | "warn" | "error";
}

export interface ServerContext {
  readonly indexer: unknown;
  readonly store: unknown;
  readonly configs: ReadonlyArray<SiteConfig>;
  readonly formatter: unknown;
  readonly logger: unknown;
}
