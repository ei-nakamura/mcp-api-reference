import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handleGetEndpoint } from '../../../src/tools/get-endpoint.js';

const createMockContext = () => ({
  indexer: { search: vi.fn() },
  store: {
    hasApi: vi.fn(),
    get: vi.fn(),
    getByApi: vi.fn().mockReturnValue([]),
  },
  formatter: {
    formatEndpointDetail: vi.fn().mockReturnValue('detail'),
    formatNotFound: vi.fn().mockReturnValue('not found'),
    formatError: vi.fn().mockReturnValue('error'),
  },
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  configs: [],
});

describe('handleGetEndpoint', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('returns formatEndpointDetail when store.get() finds doc', async () => {
    const doc = { id: 'kintone:GET:/k/v1/record.json' };
    ctx.store.get.mockReturnValue(doc);

    const result = await handleGetEndpoint(
      { api: 'kintone', endpoint: '/k/v1/record.json', method: 'GET' },
      ctx as any
    );

    expect(result.content[0].text).toBe('detail');
    expect(ctx.formatter.formatEndpointDetail).toHaveBeenCalledWith(doc);
  });

  it('returns formatNotFound when store.get() returns undefined', async () => {
    ctx.store.get.mockReturnValue(undefined);

    const result = await handleGetEndpoint(
      { api: 'kintone', endpoint: '/k/v1/missing.json', method: 'POST' },
      ctx as any
    );

    expect(result.content[0].text).toBe('not found');
    expect(ctx.formatter.formatNotFound).toHaveBeenCalled();
  });

  it('docId format is "api:METHOD:path"', async () => {
    ctx.store.get.mockReturnValue(undefined);

    await handleGetEndpoint(
      { api: 'myapi', endpoint: '/some/path', method: 'post' },
      ctx as any
    );

    expect(ctx.store.get).toHaveBeenCalledWith('myapi:POST:/some/path');
  });

  it('handles thrown errors (isError: true)', async () => {
    ctx.store.get.mockImplementation(() => { throw new Error('store failure'); });

    const result = await handleGetEndpoint(
      { api: 'kintone', endpoint: '/k/v1/record.json', method: 'GET' },
      ctx as any
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('store failure');
  });
});
