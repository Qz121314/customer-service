import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { calendarMonthPeriod } from '../src/shared/calendar-month.ts';

test('statistics period covers every day in the selected calendar month', () => {
  assert.deepEqual(calendarMonthPeriod('2026-01'), {
    start: '2026-01-01',
    end: '2026-01-31',
    dayCount: 31,
    days: Array.from({ length: 31 }, (_, index) => index + 1),
  });
  assert.equal(calendarMonthPeriod('2026-02').dayCount, 28);
  assert.equal(calendarMonthPeriod('2024-02').dayCount, 29);
  assert.equal(calendarMonthPeriod('2026-04').dayCount, 30);
  assert.equal(calendarMonthPeriod('2026-12').end, '2026-12-31');
});

test('admin and agent statistics query the complete calendar month', () => {
  const admin = readFileSync(
    new URL('../src/worker/admin-config-api.ts', import.meta.url),
    'utf8',
  );
  const agent = readFileSync(
    new URL('../src/worker/agent-api.ts', import.meta.url),
    'utf8',
  );

  for (const source of [admin, agent]) {
    assert.ok(source.includes('calendarMonthPeriod(month)'));
    assert.ok(source.includes('period.start'));
    assert.ok(source.includes('period.end'));
    assert.ok(source.includes('days: period.days'));
    assert.ok(!source.includes('`${month}-30`'));
    assert.ok(!source.includes('Array.from({ length: 30 }'));
  }
});

test('statistics surfaces use the shared controlled month picker', () => {
  const picker = readFileSync(
    new URL('../src/dashboard/MonthPicker.tsx', import.meta.url),
    'utf8',
  );
  const surfaces = [
    '../src/dashboard/AdminAgentStatisticsModal.tsx',
    '../src/dashboard/AgentStatisticsWorkspace.tsx',
  ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));

  for (const source of surfaces) {
    assert.ok(source.includes('<MonthPicker'));
    assert.ok(!source.includes('type="month"'));
  }

  assert.ok(picker.includes('createPortal'));
  assert.ok(picker.includes('aria-haspopup="dialog"'));
  assert.ok(picker.includes('aria-expanded={open}'));
  assert.ok(picker.includes("event.key === 'Escape'"));
  assert.ok(picker.includes('MONTH_LABELS.map'));
});
