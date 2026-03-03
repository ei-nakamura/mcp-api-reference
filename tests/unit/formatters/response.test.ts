import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseFormatter } from '../../../src/formatters/response.js';
import { EndpointDocument } from '../../../src/types/document.js';
import { SearchHit } from '../../../src/core/indexer.js';
import { ApiSummary, ApiDetail } from '../../../src/core/store.js';

const makeDoc = (overrides: Partial<EndpointDocument> = {}): EndpointDocument => ({
  id: 'kintone:GET:/k/v1/record.json',
  apiId: 'kintone', category: 'records', method: 'GET' as const,
  path: '/k/v1/record.json', title: 'Get Record',
  description: 'Gets a record.', parameters: [], responseFields: [],
  examples: [], authentication: ['OAuth'], permissions: [], notes: [],
  sourceUrl: 'https://cybozu.dev/ja/kintone/docs/rest-api/records/get-record/',
  ...overrides,
});

describe('ResponseFormatter', () => {
  let formatter: ResponseFormatter;

  beforeEach(() => {
    formatter = new ResponseFormatter();
  });

  describe('formatSearchResults()', () => {
    it('returns markdown with hits', () => {
      const doc = makeDoc();
      const hit: SearchHit = {
        id: doc.id, apiId: doc.apiId, score: 1.0,
        title: doc.title, method: 'GET', path: doc.path, category: doc.category,
      };
      const docs = new Map([[doc.id, doc]]);
      const result = formatter.formatSearchResults('record', [hit], docs);
      expect(result).toContain('GET');
      expect(result).toContain('/k/v1/record.json');
      expect(result).toContain('Get Record');
    });

    it('returns "No results" message for empty hits', () => {
      const result = formatter.formatSearchResults('unknown', [], new Map());
      expect(result).toContain('No results');
      expect(result).toContain('unknown');
    });
  });

  describe('formatEndpointDetail()', () => {
    it('contains method, path, description', () => {
      const doc = makeDoc({ description: 'Gets a record.' });
      const result = formatter.formatEndpointDetail(doc);
      expect(result).toContain('GET');
      expect(result).toContain('/k/v1/record.json');
      expect(result).toContain('Gets a record.');
    });
  });

  describe('formatApiList()', () => {
    it('contains api names', () => {
      const summaries: ApiSummary[] = [
        { apiId: 'kintone', categories: ['records'], endpointCount: 10 },
      ];
      const result = formatter.formatApiList(summaries);
      expect(result).toContain('kintone');
    });
  });

  describe('formatApiDetail()', () => {
    it('contains category and endpoint paths', () => {
      const doc = makeDoc();
      const detail: ApiDetail = {
        apiId: 'kintone',
        categories: ['records'],
        endpointCount: 1,
        endpoints: [doc],
      };
      const result = formatter.formatApiDetail(detail);
      expect(result).toContain('records');
      expect(result).toContain('/k/v1/record.json');
    });
  });

  describe('formatError()', () => {
    it('contains error message', () => {
      const result = formatter.formatError('Something went wrong');
      expect(result).toContain('Something went wrong');
    });

    it('with suggestions → includes suggestions', () => {
      const result = formatter.formatError('Error', ['Try this', 'Try that']);
      expect(result).toContain('Try this');
      expect(result).toContain('Try that');
    });
  });

  describe('formatNotFound()', () => {
    it('contains "not found" text', () => {
      const result = formatter.formatNotFound('kintone', '/k/v1/record.json', 'GET', []);
      expect(result.toLowerCase()).toContain('not found');
    });

    it('with similar docs → includes suggestions', () => {
      const similar = [makeDoc({
        path: '/k/v1/records.json',
        title: 'Get Records',
        id: 'kintone:GET:/k/v1/records.json',
      })];
      const result = formatter.formatNotFound('kintone', '/k/v1/record.json', 'GET', similar);
      expect(result).toContain('/k/v1/records.json');
    });
  });
});
