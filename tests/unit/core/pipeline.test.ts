import { vi, describe, it, expect, beforeEach } from 'vitest';
import { InitPipeline } from '../../../src/core/pipeline.js';

const createMockDeps = () => ({
  crawler: {
    crawl: vi.fn().mockResolvedValue({
      pages: new Map([['https://example.com/', '<html></html>']]),
      totalFetched: 1, skipped: 0,
    }),
  },
  parserRegistry: {
    getParser: vi.fn().mockReturnValue({
      parseEndpoint: vi.fn().mockReturnValue({ endpoints: [] }),
    }),
    getConfig: vi.fn(),
    getIds: vi.fn().mockReturnValue([]),
  },
  store: {
    set: vi.fn(), loadFromDisk: vi.fn(), saveToDisk: vi.fn(),
    totalEndpointCount: vi.fn().mockReturnValue(0),
  },
  indexer: {
    build: vi.fn(), loadFromDisk: vi.fn(), saveToDisk: vi.fn(),
  },
  cacheManager: {
    isCacheValid: vi.fn().mockReturnValue(false),
    load: vi.fn(), save: vi.fn(),
    getCacheDir: vi.fn().mockReturnValue('/tmp/test-cache'),
    ensureCacheDir: vi.fn(),
    clearAll: vi.fn(), invalidate: vi.fn(),
  },
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
});

const makeConfig = (id = 'test') => ({
  id,
  name: 'Test',
  baseUrl: 'https://example.com',
  crawl: {
    startUrl: 'https://example.com/',
    maxPages: 5,
    delayMs: 0,
    includePatterns: [] as string[],
    excludePatterns: [] as string[],
  },
  parser: { type: 'preset' as const },
});

describe('InitPipeline', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let pipeline: InitPipeline;

  beforeEach(() => {
    deps = createMockDeps();
    pipeline = new InitPipeline(deps as any);
  });

  describe('initializeAll()', () => {
    it('with empty configs completes without error', async () => {
      await expect(pipeline.initializeAll([])).resolves.toBeUndefined();
    });

    it('calls initializeSite for each config', async () => {
      const configs = [makeConfig('api1'), makeConfig('api2')];

      await pipeline.initializeAll(configs);

      expect(deps.crawler.crawl).toHaveBeenCalledTimes(2);
    });

    it('skips failed sites - 1 site error does not stop others', async () => {
      const configs = [makeConfig('fail-site'), makeConfig('ok-site')];
      deps.crawler.crawl
        .mockRejectedValueOnce(new Error('Crawl failed'))
        .mockResolvedValueOnce({
          pages: new Map([['https://example.com/', '<html></html>']]),
          totalFetched: 1, skipped: 0,
        });

      await expect(pipeline.initializeAll(configs)).resolves.toBeUndefined();

      expect(deps.logger.error).toHaveBeenCalledTimes(1);
      expect(deps.crawler.crawl).toHaveBeenCalledTimes(2);
    });
  });

  describe('initializeSite()', () => {
    it('uses cache when isCacheValid returns true', async () => {
      deps.cacheManager.isCacheValid.mockReturnValue(true);

      await pipeline.initializeAll([makeConfig()]);

      // cache hit → runPipeline not called → crawler not called
      expect(deps.crawler.crawl).not.toHaveBeenCalled();
      expect(deps.store.loadFromDisk).toHaveBeenCalled();
      expect(deps.indexer.loadFromDisk).toHaveBeenCalled();
    });

    it('calls runPipeline when cache invalid', async () => {
      deps.cacheManager.isCacheValid.mockReturnValue(false);

      await pipeline.initializeAll([makeConfig()]);

      expect(deps.crawler.crawl).toHaveBeenCalledTimes(1);
    });

    it('calls runPipeline when forceRefresh=true even if cache valid', async () => {
      deps.cacheManager.isCacheValid.mockReturnValue(true);
      const config = makeConfig();

      // refreshTarget matches config.id → forceRefresh=true → skip cache check
      await pipeline.initializeAll([config], config.id);

      expect(deps.crawler.crawl).toHaveBeenCalledTimes(1);
    });
  });

  describe('runPipeline()', () => {
    it('calls crawler.crawl → parserRegistry.getParser → store.set → indexer.build → cacheManager.save', async () => {
      deps.cacheManager.isCacheValid.mockReturnValue(false);
      const config = makeConfig();

      await pipeline.initializeAll([config]);

      expect(deps.crawler.crawl).toHaveBeenCalledWith(config.crawl, expect.any(Function));
      expect(deps.parserRegistry.getParser).toHaveBeenCalledWith(config.id);
      expect(deps.store.set).toHaveBeenCalledWith(config.id, expect.any(Array));
      expect(deps.indexer.build).toHaveBeenCalledWith(config.id, expect.any(Array));
      expect(deps.cacheManager.save).toHaveBeenCalledWith(config.id, expect.any(String), expect.any(Object));
    });
  });
});
