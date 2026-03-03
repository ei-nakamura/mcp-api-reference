import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handleSearchDocs } from '../../../src/tools/search-docs.js';

const createMockContext = () => ({
  indexer: { search: vi.fn() },
  store: { hasApi: vi.fn(), getApiIds: vi.fn(), get: vi.fn() },
  formatter: {
    formatSearchResults: vi.fn().mockReturnValue('results'),
    formatError: vi.fn().mockReturnValue('error'),
  },
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  configs: [],
});

describe('handleSearchDocs', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('returns search results when hits found', async () => {
    ctx.store.hasApi.mockReturnValue(true);
    ctx.indexer.search.mockReturnValue([{ id: 'kintone:GET:/k/v1/record.json', score: 1 }]);
    ctx.store.get.mockReturnValue({ id: 'kintone:GET:/k/v1/record.json' });

    const result = await handleSearchDocs({ query: 'record', api: 'kintone' }, ctx as any);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('results');
    expect(ctx.formatter.formatSearchResults).toHaveBeenCalledOnce();
  });

  it('returns error text when api not found', async () => {
    ctx.store.hasApi.mockReturnValue(false);
    ctx.store.getApiIds.mockReturnValue(['backlog']);

    const result = await handleSearchDocs({ query: 'test', api: 'unknown' }, ctx as any);

    expect(result.content[0].text).toBe('error');
    expect(ctx.formatter.formatError).toHaveBeenCalledWith(
      "API 'unknown' not found.",
      expect.any(Array)
    );
  });

  it('returns error text when no hits', async () => {
    ctx.store.hasApi.mockReturnValue(true);
    ctx.indexer.search.mockReturnValue([]);

    const result = await handleSearchDocs({ query: 'nothing' }, ctx as any);

    expect(result.content[0].text).toBe('error');
    expect(ctx.formatter.formatError).toHaveBeenCalledWith(
      expect.stringContaining('No results'),
      expect.any(Array)
    );
  });

  it('passes limit to indexer.search correctly', async () => {
    ctx.store.hasApi.mockReturnValue(true);
    ctx.indexer.search.mockReturnValue([{ id: 'x', score: 1 }]);
    ctx.store.get.mockReturnValue({ id: 'x' });

    await handleSearchDocs({ query: 'q', limit: 10 }, ctx as any);

    expect(ctx.indexer.search).toHaveBeenCalledWith('q', { apiId: undefined, limit: 10 });
  });

  it('handles thrown errors (isError: true)', async () => {
    ctx.store.hasApi.mockImplementation(() => { throw new Error('store error'); });

    const result = await handleSearchDocs({ query: 'q', api: 'kintone' }, ctx as any);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('store error');
  });
});
