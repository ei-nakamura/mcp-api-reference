/**
 * @module types/config
 * @description 設定関連の型定義とZodスキーマ。
 * クロール設定・パーサー設定・サイト設定・サーバーオプションを定義する。
 */
import { z } from "zod";

/** クロール設定のZodスキーマ */
export const CrawlConfigSchema = z.object({
  startUrl: z.string().url(),
  includePatterns: z.array(z.string()).default([]),
  excludePatterns: z.array(z.string()).default([]),
  maxPages: z.number().int().positive().default(500),
  delayMs: z.number().int().nonnegative().default(500),
});

/** クロール設定の型 */
export type CrawlConfig = z.infer<typeof CrawlConfigSchema>;

/**
 * パーサー設定のZodスキーマ。
 * "preset": 組み込みパーサーを使用 / "generic": CSSセレクタベースの汎用パーサーを使用
 */
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

/** パーサー設定の型 */
export type ParserConfig = z.infer<typeof ParserConfigSchema>;

/** サイト設定のZodスキーマ。APIドキュメントサイトの全情報を定義する。 */
export const SiteConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  baseUrl: z.string().url(),
  crawl: CrawlConfigSchema,
  parser: ParserConfigSchema,
});

/** サイト設定の型 */
export type SiteConfig = z.infer<typeof SiteConfigSchema>;

/** プリセット設定。SiteConfigに加えてプリセットモジュール名を持つ。 */
export interface PresetConfig extends SiteConfig {
  /** プリセットモジュール名 (例: "kintone") */
  presetModule: string;
}

/** サーバー起動オプション */
export interface ServerOptions {
  /** 強制再取得対象のAPI ID ("all" で全API) */
  refreshTarget?: string;
  /** カスタムサイト設定ファイルのパス */
  configPath?: string;
  /** キャッシュディレクトリのパス */
  cacheDir?: string;
  /** キャッシュの有効期間 (日数) */
  ttlDays?: number;
  /** ログレベル */
  logLevel?: "debug" | "info" | "warn" | "error";
}

/** サーバーコンテキスト (config.ts側の簡易定義。実際の型はcontext.tsで定義) */
export interface ServerContext {
  readonly indexer: unknown;
  readonly store: unknown;
  readonly configs: ReadonlyArray<SiteConfig>;
  readonly formatter: unknown;
  readonly logger: unknown;
}
