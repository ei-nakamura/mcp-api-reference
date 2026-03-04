import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { CacheManager } from '../../../src/core/cache.js';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('CacheManager', () => {
  let tmpDir: string;
  let cache: CacheManager;
  const TTL = 60 * 60 * 1000; // 1 hour

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-test-'));
    cache = new CacheManager(tmpDir, TTL, mockLogger as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('isCacheValid() returns false when no meta file exists', () => {
    expect(cache.isCacheValid('api1', 'hash123')).toBe(false);
  });

  it('isCacheValid() returns false when configHash differs', () => {
    cache.save('api1', 'hash-a', { documents: [], indexData: {} });
    expect(cache.isCacheValid('api1', 'hash-b')).toBe(false);
  });

  it('isCacheValid() returns false when TTL expired', () => {
    const expiredCache = new CacheManager(tmpDir, -1, mockLogger as any);
    expiredCache.save('api1', 'hash123', { documents: [], indexData: {} });
    expect(expiredCache.isCacheValid('api1', 'hash123')).toBe(false);
  });

  it('isCacheValid() returns true when valid (same hash, within TTL)', () => {
    cache.save('api1', 'hash123', { documents: [], indexData: {} });
    expect(cache.isCacheValid('api1', 'hash123')).toBe(true);
  });

  it('save() creates meta.json + documents.json + index.json', () => {
    cache.save('api1', 'hash123', { documents: [], indexData: { key: 'value' } });
    const dir = cache.getCacheDir('api1');
    expect(fs.existsSync(path.join(dir, 'meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'documents.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'index.json'))).toBe(true);
  });

  it('load() reads and returns saved data', () => {
    const docs = [{
      id: 'api1:GET:/test', apiId: 'api1', category: 'test', method: 'GET' as const,
      path: '/test', title: 'Test', description: '', parameters: [], responseFields: [],
      examples: [], authentication: [], permissions: [], notes: [], sourceUrl: 'http://example.com',
    }];
    const indexData = { key: 'val' };
    cache.save('api1', 'hash123', { documents: docs, indexData });
    const result = cache.load('api1');
    expect(result.documents).toHaveLength(1);
    expect(result.indexData).toEqual(indexData);
  });

  it('invalidate() removes the api cache dir', () => {
    cache.save('api1', 'hash123', { documents: [], indexData: {} });
    const dir = cache.getCacheDir('api1');
    expect(fs.existsSync(dir)).toBe(true);
    cache.invalidate('api1');
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('clearAll() removes all subdirectories', () => {
    cache.save('api1', 'hash123', { documents: [], indexData: {} });
    cache.save('api2', 'hash456', { documents: [], indexData: {} });
    cache.clearAll();
    expect(fs.existsSync(cache.getCacheDir('api1'))).toBe(false);
    expect(fs.existsSync(cache.getCacheDir('api2'))).toBe(false);
  });

  it('getCacheDir() returns correct path', () => {
    expect(cache.getCacheDir('api1')).toBe(path.join(tmpDir, 'api1'));
  });
});
