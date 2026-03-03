import { Logger } from "../utils/logger.js";
import { CrawlConfig } from "../types/config.js";
import { CrawlError } from "../types/errors.js";
import { matchesPatterns } from "../utils/glob.js";

export interface CrawlResult {
  pages: Map<string, string>;   // URL → HTML
  totalFetched: number;
  skipped: number;
}

interface RobotsRule {
  path: string;
  allowed: boolean;
}

export class Crawler {
  private readonly userAgent = "mcp-api-reference/1.0";
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async crawl(
    config: CrawlConfig,
    onProgress?: (fetched: number, total: number) => void
  ): Promise<CrawlResult> {
    const pages = new Map<string, string>();
    const visited = new Set<string>();
    const queue: string[] = [config.startUrl];
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
          if (!visited.has(link) && !queue.includes(link)) {
            queue.push(link);
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
    queue.length = 0;

    return {
      pages,
      totalFetched: pages.size,
      skipped,
    };
  }

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

        return await response.text();
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
        // Invalid URL — skip
      }
    }

    return links;
  }

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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
