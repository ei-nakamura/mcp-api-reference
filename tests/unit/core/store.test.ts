import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { DocumentStore } from '../../../src/core/store.js';
import { EndpointDocument } from '../../../src/types/document.js';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

const makeDoc = (id: string, apiId: string, category = 'cat'): EndpointDocument => ({
  id, apiId, category, method: 'GET' as const, path: '/test',
  title: 'Test', description: '', parameters: [], responseFields: [],
  examples: [], authentication: [], permissions: [], notes: [], sourceUrl: 'http://example.com',
});

describe('DocumentStore', () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore(mockLogger as any);
    vi.clearAllMocks();
  });

  it('set() stores docs and updates index + metadata', () => {
    const docs = [makeDoc('api1:GET:/a', 'api1'), makeDoc('api1:GET:/b', 'api1')];
    store.set('api1', docs);
    expect(store.getByApi('api1')).toHaveLength(2);
    expect(store.get('api1:GET:/a')).toBeDefined();
    expect(store.get('api1:GET:/b')).toBeDefined();
    expect(store.hasApi('api1')).toBe(true);
  });

  it('get() returns doc by id', () => {
    const doc = makeDoc('api1:GET:/a', 'api1');
    store.set('api1', [doc]);
    expect(store.get('api1:GET:/a')).toEqual(doc);
  });

  it('get() returns undefined for unknown id', () => {
    expect(store.get('unknown')).toBeUndefined();
  });

  it('getByApi() returns docs for api', () => {
    const docs = [makeDoc('api1:GET:/a', 'api1')];
    store.set('api1', docs);
    expect(store.getByApi('api1')).toEqual(docs);
  });

  it('getByApi() returns [] for unknown api', () => {
    expect(store.getByApi('unknown')).toEqual([]);
  });

  it('hasApi() returns true when set', () => {
    store.set('api1', [makeDoc('api1:GET:/a', 'api1')]);
    expect(store.hasApi('api1')).toBe(true);
  });

  it('hasApi() returns false when not set', () => {
    expect(store.hasApi('nope')).toBe(false);
  });

  it('getApiIds() returns array of known api ids', () => {
    store.set('api1', [makeDoc('api1:GET:/a', 'api1')]);
    store.set('api2', [makeDoc('api2:GET:/b', 'api2')]);
    const ids = store.getApiIds();
    expect(ids).toContain('api1');
    expect(ids).toContain('api2');
  });

  it('getAllApiSummaries() returns metadata summaries', () => {
    store.set('api1', [makeDoc('api1:GET:/a', 'api1', 'catA')]);
    const summaries = store.getAllApiSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].apiId).toBe('api1');
    expect(summaries[0].endpointCount).toBe(1);
  });

  it('getApiDetail() returns detail with endpoints', () => {
    const docs = [makeDoc('api1:GET:/a', 'api1')];
    store.set('api1', docs);
    const detail = store.getApiDetail('api1');
    expect(detail).toBeDefined();
    expect(detail!.apiId).toBe('api1');
    expect(detail!.endpoints).toHaveLength(1);
  });

  it('getApiDetail() returns undefined for unknown api', () => {
    expect(store.getApiDetail('unknown')).toBeUndefined();
  });

  it('totalEndpointCount() returns correct sum', () => {
    store.set('api1', [makeDoc('api1:GET:/a', 'api1'), makeDoc('api1:GET:/b', 'api1')]);
    store.set('api2', [makeDoc('api2:GET:/c', 'api2')]);
    expect(store.totalEndpointCount()).toBe(3);
  });

  it('remove() removes docs, index, and metadata', () => {
    store.set('api1', [makeDoc('api1:GET:/a', 'api1')]);
    store.remove('api1');
    expect(store.hasApi('api1')).toBe(false);
    expect(store.getByApi('api1')).toEqual([]);
    expect(store.get('api1:GET:/a')).toBeUndefined();
  });

  it('findSimilar() returns docs in same category (excluding self)', () => {
    const doc1 = makeDoc('api1:GET:/a', 'api1', 'records');
    const doc2 = makeDoc('api1:GET:/b', 'api1', 'records');
    const doc3 = makeDoc('api1:GET:/c', 'api1', 'other');
    store.set('api1', [doc1, doc2, doc3]);
    const similar = store.findSimilar('api1', doc1);
    expect(similar).toContain(doc2);
    expect(similar).not.toContain(doc1);
    expect(similar).not.toContain(doc3);
  });

  it('saveToDisk() + loadFromDisk() round-trip', () => {
    const filePath = path.join(os.tmpdir(), `store-test-${Date.now()}.json`);
    const docs = [makeDoc('api1:GET:/a', 'api1')];
    store.set('api1', docs);
    store.saveToDisk('api1', filePath);
    const store2 = new DocumentStore(mockLogger as any);
    store2.loadFromDisk('api1', filePath);
    expect(store2.getByApi('api1')).toHaveLength(1);
    expect(store2.get('api1:GET:/a')).toBeDefined();
    fs.unlinkSync(filePath);
  });
});
