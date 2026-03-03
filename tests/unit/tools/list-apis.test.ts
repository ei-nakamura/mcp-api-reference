import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handleListApis } from '../../../src/tools/list-apis.js';

const createMockContext = () => ({
  indexer: { search: vi.fn() },
  store: {
    hasApi: vi.fn(),
    getApiIds: vi.fn().mockReturnValue([]),
    getAllApiSummaries: vi.fn().mockReturnValue([]),
    getApiDetail: vi.fn(),
  },
  formatter: {
    formatApiList: vi.fn().mockReturnValue('api list'),
    formatApiDetail: vi.fn().mockReturnValue('api detail'),
    formatError: vi.fn().mockReturnValue('error'),
  },
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  configs: [],
});

describe('handleListApis', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('no api arg → calls store.getAllApiSummaries() → formatApiList()', async () => {
    const summaries = [{ id: 'kintone' }];
    ctx.store.getAllApiSummaries.mockReturnValue(summaries);

    const result = await handleListApis({}, ctx as any);

    expect(result.content[0].text).toBe('api list');
    expect(ctx.store.getAllApiSummaries).toHaveBeenCalledOnce();
    expect(ctx.formatter.formatApiList).toHaveBeenCalledWith(summaries);
  });

  it('api arg found → calls store.getApiDetail() → formatApiDetail()', async () => {
    ctx.store.hasApi.mockReturnValue(true);
    const detail = { id: 'kintone', endpoints: [] };
    ctx.store.getApiDetail.mockReturnValue(detail);

    const result = await handleListApis({ api: 'kintone' }, ctx as any);

    expect(result.content[0].text).toBe('api detail');
    expect(ctx.formatter.formatApiDetail).toHaveBeenCalledWith(detail);
  });

  it('api arg not found → formatError()', async () => {
    ctx.store.hasApi.mockReturnValue(false);
    ctx.store.getApiIds.mockReturnValue(['backlog']);

    const result = await handleListApis({ api: 'unknown' }, ctx as any);

    expect(result.content[0].text).toBe('error');
    expect(ctx.formatter.formatError).toHaveBeenCalledWith(
      "API 'unknown' not found.",
      expect.any(Array)
    );
  });

  it('getApiDetail() returns null → formatError()', async () => {
    ctx.store.hasApi.mockReturnValue(true);
    ctx.store.getApiDetail.mockReturnValue(null);

    const result = await handleListApis({ api: 'kintone' }, ctx as any);

    expect(result.content[0].text).toBe('error');
    expect(ctx.formatter.formatError).toHaveBeenCalledWith(
      "API 'kintone' has no data."
    );
  });

  it('handles thrown errors (isError: true)', async () => {
    ctx.store.hasApi.mockImplementation(() => { throw new Error('store crash'); });

    const result = await handleListApis({ api: 'kintone' }, ctx as any);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('store crash');
  });
});
