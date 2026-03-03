import { describe, it, expect } from 'vitest';
import { globToRegex } from '../../../src/utils/glob.js';

describe('globToRegex', () => {
  it('* matches single path segments (no slash)', () => {
    const re = globToRegex('*');
    expect(re.test('foo')).toBe(true);
    expect(re.test('foo/bar')).toBe(false);
  });

  it('** matches across segments', () => {
    const re = globToRegex('**');
    expect(re.test('foo')).toBe(true);
    expect(re.test('foo/bar')).toBe(true);
    expect(re.test('foo/bar/baz')).toBe(true);
  });

  it('/k/v1/*.json matches /k/v1/record.json', () => {
    const re = globToRegex('/k/v1/*.json');
    expect(re.test('/k/v1/record.json')).toBe(true);
  });

  it('/k/v1/*.json does NOT match /k/v1/sub/record.json', () => {
    const re = globToRegex('/k/v1/*.json');
    expect(re.test('/k/v1/sub/record.json')).toBe(false);
  });

  it('/k/** matches all subpaths', () => {
    const re = globToRegex('/k/**');
    expect(re.test('/k/v1/record.json')).toBe(true);
    expect(re.test('/k/v2/bulk')).toBe(true);
    expect(re.test('/k/')).toBe(true);
  });
});
