import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ParserRegistry, SiteParser } from '../../../src/core/parser.js';
import { Logger } from '../../../src/utils/logger.js';
import { PresetConfig } from '../../../src/types/config.js';

const logger = new Logger('error');

const mockParser: SiteParser = {
  name: 'test-parser',
  parseEndpoint: vi.fn().mockReturnValue({ endpoints: [] }),
};

const mockConfig: PresetConfig = {
  id: 'test',
  name: 'Test API',
  baseUrl: 'https://test.com',
  crawl: {
    startUrl: 'https://test.com/',
    maxPages: 10,
    delayMs: 0,
    includePatterns: [],
    excludePatterns: [],
  },
  parser: { type: 'preset' },
  presetModule: 'test',
};

describe('ParserRegistry', () => {
  let registry: ParserRegistry;

  beforeEach(() => {
    registry = new ParserRegistry(logger);
  });

  it('register() adds a parser', () => {
    registry.register('test', mockConfig, mockParser);

    expect(registry.getParser('test')).toBe(mockParser);
  });

  it('getParser() returns registered parser', () => {
    registry.register('test', mockConfig, mockParser);
    const parser = registry.getParser('test');

    expect(parser).toBe(mockParser);
    expect(parser?.name).toBe('test-parser');
  });

  it('getParser() returns undefined for unknown id', () => {
    expect(registry.getParser('nonexistent')).toBeUndefined();
  });

  it('getConfig() returns registered config', () => {
    registry.register('test', mockConfig, mockParser);

    expect(registry.getConfig('test')).toBe(mockConfig);
  });

  it('getConfig() returns undefined for unknown id', () => {
    expect(registry.getConfig('nonexistent')).toBeUndefined();
  });

  it('getIds() returns all registered ids', () => {
    const mockConfig2 = { ...mockConfig, id: 'test2' };
    registry.register('test1', mockConfig, mockParser);
    registry.register('test2', mockConfig2, mockParser);

    const ids = registry.getIds();

    expect(ids).toContain('test1');
    expect(ids).toContain('test2');
    expect(ids).toHaveLength(2);
  });
});
