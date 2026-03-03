/**
 * @module parser
 * @description パーサーレジストリモジュール。
 * Strategyパターンにより、APIサイトごとに異なるHTMLパーサーを差し替え可能にする。
 */
import { EndpointDocument } from "../types/document.js";
import { PresetConfig } from "../types/config.js";
import { Logger } from "../utils/logger.js";

/** パース結果。1ページから抽出されたエンドポイント情報の配列を保持する。 */
export interface ParseResult {
  /** 抽出されたエンドポイントドキュメントの配列 */
  endpoints: EndpointDocument[];
}

/**
 * サイトパーサーのインターフェース。
 * Strategyパターンにより、プリセットごとに異なるパーサー実装を差し替え可能にする。
 */
export interface SiteParser {
  /** パーサー名 (例: "kintone") */
  readonly name: string;
  /**
   * ページ内のエンドポイントURLを抽出する (省略可能)。
   * 省略した場合は全ページを {@link parseEndpoint} にかける。
   */
  extractEndpointUrls?(html: string, pageUrl: string): string[];
  /**
   * 単一ページのHTMLからエンドポイント情報を抽出する。
   * @param html - ページのHTML文字列
   * @param pageUrl - ページのURL
   * @param apiId - API識別子
   * @returns パース結果
   */
  parseEndpoint(html: string, pageUrl: string, apiId: string): ParseResult;
}

/**
 * パーサーレジストリ。
 * API IDをキーとしてパーサーと設定を管理する。
 */
export class ParserRegistry {
  /** API ID → パーサーのマッピング */
  private parsers: Map<string, SiteParser> = new Map();
  /** API ID → プリセット設定のマッピング */
  private configs: Map<string, PresetConfig> = new Map();

  constructor(private logger: Logger) {}

  /**
   * パーサーをレジストリに登録する。
   * @param id - API識別子
   * @param config - プリセット設定
   * @param parser - パーサー実装
   */
  register(id: string, config: PresetConfig, parser: SiteParser): void {
    this.parsers.set(id, parser);
    this.configs.set(id, config);
    this.logger.debug(`Parser registered: ${id}`);
  }

  /** 指定IDのパーサーを取得する */
  getParser(id: string): SiteParser | undefined {
    return this.parsers.get(id);
  }

  /** 指定IDのプリセット設定を取得する */
  getConfig(id: string): PresetConfig | undefined {
    return this.configs.get(id);
  }

  /** 登録済みの全API IDを取得する */
  getIds(): string[] {
    return Array.from(this.parsers.keys());
  }
}
