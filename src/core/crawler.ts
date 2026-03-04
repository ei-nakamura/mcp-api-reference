/**
 * @module crawler
 * @description Webクローラーモジュール。
 * 指定されたURLからAPIドキュメントページを巡回し、HTMLを収集する。
 * robots.txtの遵守、リトライ制御、リクエスト間隔の制御、SSRF防止を行う。
 */
import * as dns from "node:dns/promises";
import * as net from "node:net";
import { Logger } from "../utils/logger.js";
import { CrawlConfig } from "../types/config.js";
import { CrawlError } from "../types/errors.js";
import { matchesPatterns } from "../utils/glob.js";

/** 1レスポンスあたりの最大サイズ (5MB) */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * IPアドレスがプライベート/予約済みアドレスかどうかを判定する。
 * SSRF防止のため、内部ネットワークへのリクエストをブロックする。
 */
export function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 127) return true;                                         // 127.0.0.0/8 (loopback)
    if (parts[0] === 10) return true;                                          // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;    // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true;                    // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true;                    // 169.254.0.0/16 (link-local)
    if (parts[0] === 0) return true;                                           // 0.0.0.0/8
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;               // loopback / unspecified
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA (fc00::/7)
    if (normalized.startsWith("fe80")) return true;                            // link-local (fe80::/10)
    return false;
  }
  return false;
}

/** クロール結果 */
export interface CrawlResult {
  /** 取得したページの URL → HTML のマッピング */
  pages: Map<string, string>;
  /** 正常に取得できたページ数 */
  totalFetched: number;
  /** スキップしたURL数 (訪問済み・除外パターン・エラー等) */
  skipped: number;
}

/** robots.txtから解析した単一のルール */
interface RobotsRule {
  /** 対象パスのプレフィックス */
  path: string;
  /** true: Allow / false: Disallow */
  allowed: boolean;
}

/**
 * Webクローラー。
 * 幅優先探索でページを巡回し、include/excludeパターンとrobots.txtに基づいてフィルタリングする。
 */
export class Crawler {
  /** HTTPリクエストに使用するUser-Agent */
  private readonly userAgent = "mcp-api-reference/1.0";
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * 指定された設定に基づいてWebページをクロールする。
   * 幅優先探索でリンクを辿り、ページのHTMLを収集する。
   * @param config - クロール設定 (開始URL、パターン、最大ページ数等)
   * @param onProgress - 進捗コールバック (取得済み数, 推定総数)
   * @returns クロール結果
   */
  async crawl(
    config: CrawlConfig,
    onProgress?: (fetched: number, total: number) => void
  ): Promise<CrawlResult> {
    // SSRF防止: 開始URLのホスト名を検証
    await this.validateUrlSafety(config.startUrl);

    const pages = new Map<string, string>();
    const visited = new Set<string>();
    const queue: string[] = [config.startUrl];
    const queued = new Set<string>([config.startUrl]);
    const startOrigin = new URL(config.startUrl).origin;
    let skipped = 0;

    const robots = await this.fetchRobotsTxt(startOrigin);

    while (queue.length > 0) {
      const url = queue.shift()!;

      if (!this.shouldVisit(url, config, robots, visited, startOrigin)) {
        skipped++;
        continue;
      }

      visited.add(url);

      try {
        const html = await this.fetchPage(url);
        pages.set(url, html);
        this.logger.info(`Fetched: ${url}`);

        if (onProgress) {
          onProgress(pages.size, pages.size + queue.length);
        }

        const links = this.extractLinks(html, url);
        for (const link of links) {
          if (!visited.has(link) && !queued.has(link)) {
            queue.push(link);
            queued.add(link);
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch: ${url}`, err);
        skipped++;
      }

      if (queue.length > 0) {
        await this.delay(config.delayMs);
      }
    }

    visited.clear();
    queued.clear();
    queue.length = 0;

    return {
      pages,
      totalFetched: pages.size,
      skipped,
    };
  }

  /**
   * 単一ページのHTMLを取得する。
   * 5xxエラー時は最大2回リトライし、30秒でタイムアウトする。
   * レスポンスサイズが MAX_RESPONSE_BYTES を超える場合は中断する。
   * @param url - 取得対象のURL
   * @returns HTMLテキスト
   * @throws {CrawlError} 取得失敗時
   */
  private async fetchPage(url: string): Promise<string> {
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 3000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(url, {
          headers: { "User-Agent": this.userAgent },
          signal: controller.signal,
          redirect: "follow",
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (response.status >= 500 && attempt < MAX_RETRIES) {
            await this.delay(RETRY_DELAY_MS);
            continue;
          }
          throw new CrawlError(
            `HTTP ${response.status}: ${response.statusText}`,
            url,
            response.status
          );
        }

        return await this.readResponseWithLimit(response, url);
      } catch (err) {
        clearTimeout(timeoutId);

        if (err instanceof CrawlError) {
          throw err;
        }

        if (attempt < MAX_RETRIES) {
          this.logger.warn(`Retry ${attempt + 1}/${MAX_RETRIES} for ${url}`, err);
          await this.delay(RETRY_DELAY_MS);
          continue;
        }

        throw new CrawlError(
          err instanceof Error ? err.message : "Network error",
          url
        );
      }
    }

    throw new CrawlError("Max retries exceeded", url);
  }

  /**
   * 対象オリジンのrobots.txtを取得・解析する。
   * 取得失敗時は空のルール配列を返す (全URL許可扱い)。
   * @param origin - オリジンURL (例: "https://example.com")
   * @returns robots.txtのルール配列
   */
  private async fetchRobotsTxt(origin: string): Promise<RobotsRule[]> {
    const robotsUrl = `${origin}/robots.txt`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(robotsUrl, {
        headers: { "User-Agent": this.userAgent },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return [];
      }

      const text = await response.text();
      return this.parseRobotsTxt(text);
    } catch {
      return [];
    }
  }

  /**
   * robots.txtのテキストを解析し、User-Agent: * に適用されるルールを抽出する。
   * @param text - robots.txtの生テキスト
   * @returns Allow/Disallowルールの配列
   */
  private parseRobotsTxt(text: string): RobotsRule[] {
    const rules: RobotsRule[] = [];
    const lines = text.split("\n").map((l) => l.trim());

    let isRelevantAgent = false;

    for (const line of lines) {
      if (line.toLowerCase().startsWith("user-agent:")) {
        const agent = line.slice("user-agent:".length).trim();
        isRelevantAgent = agent === "*";
      } else if (isRelevantAgent && line.toLowerCase().startsWith("disallow:")) {
        const path = line.slice("disallow:".length).trim();
        if (path) {
          rules.push({ path, allowed: false });
        }
      } else if (isRelevantAgent && line.toLowerCase().startsWith("allow:")) {
        const path = line.slice("allow:".length).trim();
        if (path) {
          rules.push({ path, allowed: true });
        }
      }
    }

    return rules;
  }

  /**
   * HTMLからリンク (<a href>) を抽出する。
   * フラグメントは除去し、http/httpsスキームのリンクのみを返す。
   * @param html - HTML文字列
   * @param baseUrl - 相対URLを解決するための基準URL
   * @returns 抽出されたURLの配列
   */
  private extractLinks(html: string, baseUrl: string): string[] {
    const links: string[] = [];
    const hrefRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = hrefRegex.exec(html)) !== null) {
      const href = match[1];
      if (!href) continue;

      try {
        const url = new URL(href, baseUrl);
        url.hash = "";

        if (url.protocol === "http:" || url.protocol === "https:") {
          links.push(url.toString());
        }
      } catch {
        // 不正なURL — スキップ
      }
    }

    return links;
  }

  /**
   * 指定URLを訪問すべきかどうかを判定する。
   * 訪問済み、最大ページ数超過、別オリジン、パターン不一致、robots.txt拒否の場合はfalseを返す。
   * @param url - 判定対象のURL
   * @param config - クロール設定
   * @param robots - robots.txtルール
   * @param visited - 訪問済みURLセット
   * @param startOrigin - 開始URLのオリジン
   * @returns 訪問すべきならtrue
   */
  private shouldVisit(
    url: string,
    config: CrawlConfig,
    robots: RobotsRule[],
    visited: Set<string>,
    startOrigin: string
  ): boolean {
    if (visited.has(url)) return false;

    if (visited.size >= config.maxPages) return false;

    try {
      const urlObj = new URL(url);
      if (urlObj.origin !== startOrigin) return false;

      if (!matchesPatterns(url, config.includePatterns, config.excludePatterns)) {
        return false;
      }

      const urlPath = urlObj.pathname + urlObj.search;
      for (const rule of robots) {
        if (!rule.allowed && urlPath.startsWith(rule.path)) {
          return false;
        }
      }
    } catch {
      return false;
    }

    return true;
  }

  /**
   * URLのホスト名をDNS解決し、プライベートIPへのアクセスを防止する (SSRF対策)。
   * @param url - 検証対象のURL
   * @throws {CrawlError} プライベートIPに解決された場合
   */
  private async validateUrlSafety(url: string): Promise<void> {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // IPアドレスが直接指定されている場合
    if (net.isIP(hostname)) {
      if (isPrivateIP(hostname)) {
        throw new CrawlError(
          `Access to private IP address is blocked: ${hostname}`,
          url
        );
      }
      return;
    }

    // ホスト名をDNS解決してIPアドレスを検証
    try {
      const { address } = await dns.lookup(hostname);
      if (isPrivateIP(address)) {
        throw new CrawlError(
          `Hostname '${hostname}' resolves to private IP address (${address}). Access blocked for security.`,
          url
        );
      }
    } catch (err) {
      if (err instanceof CrawlError) throw err;
      throw new CrawlError(
        `DNS resolution failed for '${hostname}': ${err instanceof Error ? err.message : "Unknown error"}`,
        url
      );
    }
  }

  /**
   * レスポンスボディをサイズ上限付きで読み込む。
   * MAX_RESPONSE_BYTES を超えた場合は読み込みを中断しエラーを投げる。
   * @param response - fetchのレスポンス
   * @param url - リクエスト元URL (エラーメッセージ用)
   * @returns レスポンスのテキスト
   * @throws {CrawlError} サイズ超過時
   */
  private async readResponseWithLimit(response: Response, url: string): Promise<string> {
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      throw new CrawlError(
        `Response too large (Content-Length: ${contentLength} bytes, limit: ${MAX_RESPONSE_BYTES} bytes)`,
        url
      );
    }

    if (!response.body) {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf-8") > MAX_RESPONSE_BYTES) {
        throw new CrawlError(
          `Response exceeded size limit (${MAX_RESPONSE_BYTES} bytes)`,
          url
        );
      }
      return text;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new CrawlError(
            `Response exceeded size limit (${MAX_RESPONSE_BYTES} bytes)`,
            url
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks).toString("utf-8");
  }

  /** 指定ミリ秒間待機する */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
