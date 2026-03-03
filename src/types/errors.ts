/**
 * @module types/errors
 * @description カスタムエラークラスの定義。
 * 全エラーは共通基底クラス McpApiRefError を継承し、
 * エラーコードと回復可能かどうかのフラグを持つ。
 */

/**
 * アプリケーション共通の基底エラークラス。
 * 全てのカスタムエラーはこのクラスを継承する。
 */
export class McpApiRefError extends Error {
  /** エラーコード (例: "CRAWL_ERROR", "PARSE_ERROR") */
  code: string;
  /** 回復可能なエラーかどうか (trueなら処理を継続できる) */
  recoverable: boolean;

  constructor(message: string, code: string, recoverable: boolean) {
    super(message);
    this.name = "McpApiRefError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

/** クロール処理中のエラー (HTTP エラー、タイムアウト、ネットワークエラー等) */
export class CrawlError extends McpApiRefError {
  /** エラーが発生したURL */
  url: string;
  /** HTTPステータスコード (ネットワークエラーの場合は未定義) */
  statusCode?: number;

  constructor(message: string, url: string, statusCode?: number) {
    super(message, "CRAWL_ERROR", true);
    this.name = "CrawlError";
    this.url = url;
    this.statusCode = statusCode;
  }
}

/** HTML解析処理中のエラー */
export class ParseError extends McpApiRefError {
  /** 解析に失敗したページのURL */
  url: string;

  constructor(message: string, url: string) {
    super(message, "PARSE_ERROR", true);
    this.name = "ParseError";
    this.url = url;
  }
}

/** キャッシュの読み書きに関するエラー */
export class CacheError extends McpApiRefError {
  constructor(message: string) {
    super(message, "CACHE_ERROR", true);
    this.name = "CacheError";
  }
}

/** 設定の検証エラー (回復不可能) */
export class ConfigError extends McpApiRefError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR", false);
    this.name = "ConfigError";
  }
}
