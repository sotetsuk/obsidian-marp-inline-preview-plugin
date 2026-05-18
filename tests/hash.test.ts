import { describe, it, expect } from 'vitest';
import { fnv1a32 } from '../src/util/hash';

describe('fnv1a32', () => {
  it('returns the same hash for identical input', () => {
    expect(fnv1a32('hello world')).toBe(fnv1a32('hello world'));
  });

  it('handles the empty string with the FNV-1a 32-bit basis', () => {
    expect(fnv1a32('')).toBe((0x811c9dc5).toString(16));
  });

  it('returns different hashes for trivially different inputs', () => {
    expect(fnv1a32('a')).not.toBe(fnv1a32('b'));
    expect(fnv1a32('ab')).not.toBe(fnv1a32('ba'));
  });

  it('produces stable hex output (lowercase, no 0x prefix)', () => {
    const h = fnv1a32('marp');
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(h.startsWith('0x')).toBe(false);
  });

  it('is sensitive to trailing whitespace (used for cache invalidation)', () => {
    expect(fnv1a32('slide')).not.toBe(fnv1a32('slide '));
  });

  it('produces the published reference value for "foobar"', () => {
    // canonical FNV-1a 32 reference; locks the algorithm against silent drift.
    expect(fnv1a32('foobar')).toBe('bf9cf968');
  });
});
