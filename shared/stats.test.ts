import { describe, expect, it } from 'vitest';
import { computeStats, formatAverage } from './stats';

describe('computeStats', () => {
  it('returns nulls for no votes', () => {
    expect(computeStats([])).toEqual({ count: 0, average: null, min: null, max: null });
  });

  it('handles a single vote', () => {
    expect(computeStats([8])).toEqual({ count: 1, average: 8, min: 8, max: 8 });
  });

  it('computes 9.2 for votes 8 9 9 10 10', () => {
    expect(computeStats([8, 9, 9, 10, 10])).toEqual({ count: 5, average: 9.2, min: 8, max: 10 });
  });

  it('rounds half up to one decimal (33 / 4 = 8.25 -> 8.3)', () => {
    expect(computeStats([8, 8, 8, 9]).average).toBe(8.3);
  });

  it('rounds 9.35 up to 9.4 without float error (187 / 20)', () => {
    const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 9, 9, 9, 9, 9, 9, 9, 8, 8, 8];
    expect(values.reduce((a, b) => a + b, 0)).toBe(187);
    expect(computeStats(values).average).toBe(9.4);
  });
});

describe('formatAverage', () => {
  it('formats with exactly one decimal', () => {
    expect(formatAverage(9.2)).toBe('9.2');
    expect(formatAverage(9)).toBe('9.0');
  });

  it('formats null as an em dash', () => {
    expect(formatAverage(null)).toBe('—');
  });
});
