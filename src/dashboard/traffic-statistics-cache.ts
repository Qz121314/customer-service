import type { TrafficOverviewStats } from './api';

const CACHE_PREFIX = 'customer-service:traffic-stats:';

function cacheKey(from: string, to: string): string {
  return `${CACHE_PREFIX}${from}:${to}`;
}

export function readTrafficStatsCache(
  from: string,
  to: string,
): TrafficOverviewStats | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(cacheKey(from, to));
    return value ? (JSON.parse(value) as TrafficOverviewStats) : null;
  } catch {
    return null;
  }
}

export function writeTrafficStatsCache(stats: TrafficOverviewStats): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      cacheKey(stats.from, stats.to),
      JSON.stringify(stats),
    );
  } catch {
    // Local storage is an optional acceleration layer.
  }
}
