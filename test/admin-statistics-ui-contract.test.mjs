import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('admin traffic statistics uses the dedicated visual layer after shared admin styles', () => {
  const main = read('../src/dashboard/main.tsx');
  assert.match(
    main,
    /import\('\.\/admin-commercial\.css'\);[\s\S]*?import\('\.\/admin-statistics\.css'\);/u,
  );
});

test('admin traffic calendar derives richer UI from the existing monthly payload', () => {
  const page = read('../src/dashboard/AdminStatisticsPage.tsx');

  assert.ok(page.includes('calendarStartOffset(month)'));
  assert.ok(page.includes('activeDayCount'));
  assert.ok(page.includes('maxDailyCount'));
  assert.ok(page.includes('statistics-calendar-weekdays'));
  assert.ok(page.includes('statistics-calendar-grid'));
  assert.ok(page.includes('statistics-day-cell level-${level}'));
  assert.doesNotMatch(page, /getAgentMonthlyStats|fetch\(/u);
});

test('admin traffic heat levels remain isolated from the agent statistics dialog', () => {
  const css = read('../src/dashboard/admin-statistics.css');

  assert.ok(css.includes('.admin-statistics-page .statistics-day-cell.level-1'));
  assert.ok(css.includes('.admin-statistics-page .statistics-day-cell.level-2'));
  assert.ok(css.includes('.admin-statistics-page .statistics-day-cell.level-3'));
  assert.doesNotMatch(css, /\.agent-statistics-dialog/u);
});
