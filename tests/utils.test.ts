import { describe, it, expect } from 'vitest';
import { ilikeAny, localDateKey, errorMessage, haversineMeters, formatDistance, fetchAllRows } from '@/lib/utils';

describe('fetchAllRows', () => {
  // A table of n rows behind an API that caps every response at `cap` rows.
  const api = (n: number, cap: number) => {
    const table = Array.from({ length: n }, (_, i) => i);
    return async (from: number, to: number) => ({ data: table.slice(from, Math.min(to + 1, from + cap)), error: null });
  };
  it('reads past the 1,000-row cap', async () => {
    expect(await fetchAllRows(api(2500, 1000))).toHaveLength(2500);
  });
  it('still reads every row when the server caps lower than the page size', async () => {
    const rows = await fetchAllRows(api(7, 3), { pageSize: 5 });
    expect(rows).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it('stops at maxRows and surfaces errors', async () => {
    expect(await fetchAllRows(api(5000, 1000), { maxRows: 2000 })).toHaveLength(2000);
    await expect(fetchAllRows(async () => ({ data: null, error: { message: 'permission denied' } }))).rejects.toThrow('permission denied');
  });
});

describe('ilikeAny', () => {
  it('builds an or-filter over every column', () => {
    expect(ilikeAny(['name', 'code'], 'abc')).toBe('name.ilike.%abc%,code.ilike.%abc%');
  });
  it('strips characters that would break the PostgREST filter', () => {
    expect(ilikeAny(['name'], 'PT. Maju, Tbk (Jkt)')).toBe('name.ilike.%PT. Maju  Tbk  Jkt%');
  });
  it('returns null for an empty or punctuation-only term', () => {
    expect(ilikeAny(['name'], '   ')).toBeNull();
    expect(ilikeAny(['name'], ',()')).toBeNull();
  });
});

describe('localDateKey', () => {
  it('uses the local calendar date, not UTC', () => {
    // 00:30 local on 25 Sep: in UTC+7 that is still 24 Sep in UTC.
    expect(localDateKey(new Date(2026, 8, 25, 0, 30))).toBe('2026-09-25');
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('errorMessage', () => {
  it('reads a PostgrestError (a plain object, not an Error)', () => {
    expect(errorMessage({ message: 'permission denied', code: '42501' })).toBe('permission denied [42501]');
    expect(errorMessage({ message: 'bad', hint: 'try x' })).toBe('bad (try x)');
  });
  it('turns a hidden or missing record (PGRST116) into a plain sentence, not the raw API text', () => {
    const raw = { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' };
    expect(errorMessage(raw)).toBe('Data ini tidak ditemukan, atau Anda tidak punya akses ke data ini.');
    expect(errorMessage(raw)).not.toContain('PGRST116');
  });
  it('falls back when there is nothing readable', () => {
    expect(errorMessage(null, 'fallback')).toBe('fallback');
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
});

describe('distance helpers', () => {
  it('haversine is ~111 km per degree of latitude', () => {
    expect(Math.round(haversineMeters(0, 0, 1, 0) / 1000)).toBe(111);
  });
  it('formats metres and kilometres', () => {
    expect(formatDistance(42.4)).toBe('42m');
    expect(formatDistance(1530)).toBe('1.5km');
    expect(formatDistance(null)).toBe('—');
  });
});
