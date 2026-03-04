import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Crawler } from '../../../src/core/crawler.js';
import { Logger } from '../../../src/utils/logger.js';

// SSRF検証で使用されるDNS lookupをモック (テスト環境ではDNS解決不可のため)
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
}));

const logger = new Logger('error');

const baseConfig = {
  startUrl: 'https://example.com/',
  maxPages: 5,
  delayMs: 0,
  includePatterns: [] as string[],
  excludePatterns: [] as string[],
};

/** fetchモック用のヘッダーオブジェクト */
const mockHeaders = { get: () => null };

/** fetchモック用レスポンスを生成する */
const mockResponse = (body: string, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  statusText: ok ? 'OK' : 'Internal Server Error',
  text: async () => body,
  body: null,
  headers: mockHeaders,
});

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Crawler', () => {
  describe('crawl()', () => {
    it('returns pages map with fetched HTML', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse('')) // robots.txt
        .mockResolvedValueOnce(mockResponse('<html>page</html>')); // page

      const crawler = new Crawler(logger);
      const result = await crawler.crawl(baseConfig);

      expect(result.pages.size).toBe(1);
      expect(result.pages.get('https://example.com/')).toBe('<html>page</html>');
      expect(result.totalFetched).toBe(1);
    });

    it('stops at maxPages limit', async () => {
      const pageHtml = '<html><a href="/page2">link</a><a href="/page3">link</a></html>';
      mockFetch
        .mockResolvedValueOnce(mockResponse('')) // robots.txt
        .mockResolvedValueOnce(mockResponse(pageHtml)); // start page

      const crawler = new Crawler(logger);
      const config = { ...baseConfig, maxPages: 1 };
      const result = await crawler.crawl(config);

      expect(result.pages.size).toBe(1);
    });

    it('skips already-visited URLs', async () => {
      // page links back to itself
      const pageHtml = '<html><a href="https://example.com/">self-link</a></html>';
      mockFetch
        .mockResolvedValueOnce(mockResponse('')) // robots.txt
        .mockResolvedValueOnce(mockResponse(pageHtml)); // start page

      const crawler = new Crawler(logger);
      const result = await crawler.crawl(baseConfig);

      // only start page fetched; self-link skipped because already visited
      expect(result.pages.size).toBe(1);
      // fetch: robots.txt (1) + start page (1) = 2
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('handles fetch error gracefully (retries, then skips)', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse('')) // robots.txt
        .mockRejectedValue(new Error('Network error')); // all page fetches fail

      const crawler = new Crawler(logger);
      // mock delay to avoid 3s×2 retries in tests
      vi.spyOn(crawler as any, 'delay').mockResolvedValue(undefined);

      const result = await crawler.crawl(baseConfig);

      expect(result.pages.size).toBe(0);
      expect(result.skipped).toBeGreaterThan(0);
    });
  });

  describe('extractLinks()', () => {
    it('extracts absolute URLs from HTML anchor tags', () => {
      const crawler = new Crawler(logger);
      const html = '<html><a href="/api/v1">link1</a><a href="https://example.com/api/v2">link2</a></html>';
      const links: string[] = (crawler as any).extractLinks(html, 'https://example.com/');

      expect(links).toContain('https://example.com/api/v1');
      expect(links).toContain('https://example.com/api/v2');
    });

    it('skips non-http/https links', () => {
      const crawler = new Crawler(logger);
      const html = [
        '<a href="mailto:test@example.com">mail</a>',
        '<a href="javascript:void(0)">js</a>',
        '<a href="ftp://example.com/file">ftp</a>',
      ].join('');
      const links: string[] = (crawler as any).extractLinks(html, 'https://example.com/');

      expect(links).toHaveLength(0);
    });
  });

  describe('parseRobotsTxt()', () => {
    it('parses Disallow rules for User-agent: *', () => {
      const crawler = new Crawler(logger);
      const robotsTxt = [
        'User-agent: *',
        'Disallow: /private/',
        'Disallow: /admin/',
        '',
        'User-agent: Googlebot',
        'Disallow: /nothing',
      ].join('\n');

      const rules: Array<{ path: string; allowed: boolean }> = (crawler as any).parseRobotsTxt(robotsTxt);

      expect(rules).toHaveLength(2);
      expect(rules[0]).toEqual({ path: '/private/', allowed: false });
      expect(rules[1]).toEqual({ path: '/admin/', allowed: false });
    });

    it('returns empty array for empty robots.txt', () => {
      const crawler = new Crawler(logger);
      const rules = (crawler as any).parseRobotsTxt('');

      expect(rules).toEqual([]);
    });
  });

  describe('shouldVisit()', () => {
    it('returns false for already visited URLs', () => {
      const crawler = new Crawler(logger);
      const visited = new Set<string>(['https://example.com/page']);

      const result: boolean = (crawler as any).shouldVisit(
        'https://example.com/page',
        baseConfig,
        [],
        visited,
        'https://example.com',
      );

      expect(result).toBe(false);
    });

    it('returns false when maxPages reached', () => {
      const crawler = new Crawler(logger);
      const visited = new Set<string>(['p1', 'p2', 'p3', 'p4', 'p5']); // 5 entries
      const config = { ...baseConfig, maxPages: 5 };

      const result: boolean = (crawler as any).shouldVisit(
        'https://example.com/new',
        config,
        [],
        visited,
        'https://example.com',
      );

      expect(result).toBe(false);
    });
  });
});
