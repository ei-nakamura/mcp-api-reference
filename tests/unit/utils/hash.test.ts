import { describe, it, expect } from 'vitest';
import { hashConfig } from '../../../src/utils/hash.js';

describe('hashConfig', () => {
  it('returns a non-empty string', () => {
    const result = hashConfig({ key: 'value' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('same config returns same hash (deterministic)', () => {
    const config = { apiId: 'kintone', baseUrl: 'https://example.com' };
    const h1 = hashConfig(config);
    const h2 = hashConfig(config);
    expect(h1).toBe(h2);
  });

  it('different config returns different hash', () => {
    const h1 = hashConfig({ apiId: 'kintone' });
    const h2 = hashConfig({ apiId: 'backlog' });
    expect(h1).not.toBe(h2);
  });

  it('hash is a hex string (SHA-256 truncated to 16 chars)', () => {
    const result = hashConfig({ foo: 'bar' });
    expect(result).toMatch(/^[0-9a-f]+$/);
    expect(result).toHaveLength(16);
  });
});
