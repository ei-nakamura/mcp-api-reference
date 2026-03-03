/**
 * @module types/context
 * @description サーバーコンテキストとツール結果の型定義。
 */
import type { Indexer } from "../core/indexer.js";
import type { DocumentStore } from "../core/store.js";
import type { ResponseFormatter } from "../formatters/response.js";
import type { Logger } from "../utils/logger.js";
import type { SiteConfig } from "./config.js";

/**
 * MCPサーバーの共有コンテキスト。
 * 各ツールハンドラーに依存モジュールを注入するために使用する。
 */
export interface ServerContext {
  /** 全文検索インデクサー */
  readonly indexer: Indexer;
  /** エンドポイントドキュメントストア */
  readonly store: DocumentStore;
  /** サイト設定の配列 */
  readonly configs: ReadonlyArray<SiteConfig>;
  /** レスポンスフォーマッター */
  readonly formatter: ResponseFormatter;
  /** ロガー */
  readonly logger: Logger;
}

/** MCPツールの戻り値の型 */
export interface ToolResult {
  [x: string]: unknown;
  /** レスポンスコンテンツ */
  content: Array<{ type: "text"; text: string }>;
  /** エラーの場合true */
  isError?: boolean;
}
