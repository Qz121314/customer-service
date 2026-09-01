import assert from 'node:assert/strict';
import test from 'node:test';
import {
  customTrafficRange,
  parseCustomTrafficRange,
  reportingRetentionStart,
  trafficRangePeriod,
} from '../src/dashboard/traffic-statistics-range.ts';

test('traffic statistics presets keep the existing reporting windows', () => {
  const today = '2026-09-01';
  assert.deepEqual(trafficRangePeriod('today', today), {
    from: '2026-09-01',
    to: '2026-09-01',
  });
  assert.deepEqual(trafficRangePeriod('yesterday', today), {
    from: '2026-08-31',
    to: '2026-08-31',
  });
  assert.deepEqual(trafficRangePeriod('7d', today), {
    from: '2026-08-26',
    to: '2026-09-01',
  });
  assert.deepEqual(trafficRangePeriod('30d', today), {
    from: '2026-08-03',
    to: '2026-09-01',
  });
  assert.deepEqual(trafficRangePeriod('90d', today), {
    from: '2026-06-04',
    to: '2026-09-01',
  });
});

test('custom traffic statistics ranges round-trip into exact dates', () => {
  const range = customTrafficRange('2026-08-12', '2026-08-18');
  assert.equal(range, 'custom:2026-08-12:2026-08-18');
  assert.deepEqual(parseCustomTrafficRange(range), {
    from: '2026-08-12',
    to: '2026-08-18',
  });
  assert.deepEqual(trafficRangePeriod(range, '2026-09-01'), {
    from: '2026-08-12',
    to: '2026-08-18',
  });
});

test('invalid custom ranges are rejected and retention starts 89 days before today', () => {
  assert.equal(parseCustomTrafficRange('custom:2026-08-18:2026-08-12'), null);
  assert.equal(parseCustomTrafficRange('custom:2026-8-1:2026-08-12'), null);
  assert.equal(parseCustomTrafficRange('today'), null);
  assert.equal(reportingRetentionStart('2026-09-01'), '2026-06-04');
});
