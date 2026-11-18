import type { Stats } from './types';

export function computeStats(values: number[]): Stats {
  if (values.length === 0) {
    return { count: 0, average: null, min: null, max: null };
  }
  const sum = values.reduce((a, b) => a + b, 0);
  // Integer arithmetic before rounding avoids float errors such as 9.35 * 10 = 93.49999.
  const average = Math.round((sum * 10) / values.length) / 10;
  return { count: values.length, average, min: Math.min(...values), max: Math.max(...values) };
}

export function formatAverage(average: number | null): string {
  return average === null ? '—' : average.toFixed(1);
}
