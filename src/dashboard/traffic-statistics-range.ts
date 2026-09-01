export type TrafficRangePreset = 'today' | 'yesterday' | '7d' | '30d' | '90d';

export type TrafficRange = TrafficRangePreset | `custom:${string}:${string}`;

const REPORTING_TIME_ZONE = 'America/Los_Angeles';
const REPORTING_RETENTION_DAYS = 90;
const REPORTING_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function currentReportingDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function shiftReportingDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function reportingRetentionStart(
  today = currentReportingDate(),
): string {
  return shiftReportingDate(today, -(REPORTING_RETENTION_DAYS - 1));
}

export function customTrafficRange(from: string, to: string): TrafficRange {
  return `custom:${from}:${to}`;
}

export function parseCustomTrafficRange(
  value: string,
): { from: string; to: string } | null {
  if (!value.startsWith('custom:')) return null;
  const [, from, to, ...rest] = value.split(':');
  if (
    rest.length ||
    !from ||
    !to ||
    !REPORTING_DATE_PATTERN.test(from) ||
    !REPORTING_DATE_PATTERN.test(to) ||
    from > to
  ) {
    return null;
  }
  return { from, to };
}

export function trafficRangePeriod(
  range: TrafficRange,
  today = currentReportingDate(),
): { from: string; to: string } {
  const custom = parseCustomTrafficRange(range);
  if (custom) return custom;
  if (range === 'yesterday') {
    const yesterday = shiftReportingDate(today, -1);
    return { from: yesterday, to: yesterday };
  }
  const days =
    range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 1;
  return { from: shiftReportingDate(today, -(days - 1)), to: today };
}
