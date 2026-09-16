import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminApi = readFileSync('src/worker/admin-config-api.ts', 'utf8');
const dashboardApi = readFileSync('src/dashboard/api.ts', 'utf8');
const page = readFileSync('src/dashboard/PhoneCollectionPage.tsx', 'utf8');

test('phone collection is owned by the Customer Service admin API and scans messages before reads', () => {
  assert.match(
    adminApi,
    /adminConfigApi\.get\('\/api\/admin\/phone-collection'/u,
  );
  assert.match(
    adminApi,
    /adminConfigApi\.get\('\/api\/admin\/phone-collection\/export'/u,
  );
  assert.match(
    adminApi,
    /adminConfigApi\.delete\('\/api\/admin\/phone-collection'/u,
  );
  assert.match(adminApi, /adminAuthorized\(c\)/u);
  assert.match(adminApi, /collectRecentVisitorPhoneMessages\(c\.env\.DB\)/u);
  assert.match(adminApi, /FROM visitor_phone_numbers/u);
  assert.match(adminApi, /DELETE FROM visitor_phone_numbers/u);
  assert.match(adminApi, /INSERT INTO visitor_phone_download_logs/u);
});

test('Customer Service admin page exposes only count, Excel download and download logs', () => {
  assert.match(dashboardApi, /getPhoneCollection/u);
  assert.match(dashboardApi, /clearPhoneCollection/u);
  assert.match(dashboardApi, /downloadPhoneCollection/u);
  assert.match(page, /已采集手机号/u);
  assert.match(page, /下载 Excel/u);
  assert.match(page, /清空号码库/u);
  assert.match(page, /window\.confirm/u);
  assert.match(page, /下载日志/u);
  assert.doesNotMatch(page, /visitor_phone_numbers/u);
});
