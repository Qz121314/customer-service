import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { integrationApi } from '../src/worker/integration-api.ts';

function createD1(database) {
  return {
    prepare(sql) {
      let bindings = [];
      const statement = {
        bind(...values) {
          bindings = values;
          return statement;
        },
        first() {
          return database.prepare(sql).get(...bindings) ?? null;
        },
        all() {
          return { results: database.prepare(sql).all(...bindings) };
        },
        run() {
          const result = database.prepare(sql).run(...bindings);
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
  };
}

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE visitor_phone_numbers (
      number TEXT PRIMARY KEY,
      first_collected_at TEXT NOT NULL
    );
    CREATE TABLE visitor_phone_download_logs (
      id TEXT PRIMARY KEY,
      downloaded_at TEXT NOT NULL,
      row_count INTEGER NOT NULL
    );
  `);
  database
    .prepare(
      `INSERT INTO visitor_phone_numbers (number, first_collected_at)
       VALUES (?1, ?2), (?3, ?4)`,
    )
    .run(
      '13800138000',
      '2026-09-16T12:00:00.000Z',
      '13900139000',
      '2026-09-16T12:01:00.000Z',
    );
  return database;
}

const env = (database) => ({
  DB: createD1(database),
  INTEGRATION_VERIFY_TOKEN: 'test-token',
});
const request = (path, init) =>
  integrationApi.request(path, init, env(database));
let database;

test('phone collection integration endpoints require the existing integration token', async () => {
  database = createDatabase();
  const response = await request('/integration/v1/phone-collection/summary');
  assert.equal(response.status, 401);
  database.close();
});

test('phone collection exports exactly time and number and records the download', async () => {
  database = createDatabase();
  const init = { headers: { Authorization: 'Bearer test-token' } };

  const summary = await request(
    '/integration/v1/phone-collection/summary',
    init,
  );
  assert.deepEqual(await summary.json(), { count: 2 });

  const exported = await request(
    '/integration/v1/phone-collection/export',
    init,
  );
  assert.equal(exported.status, 200);
  assert.match(
    await exported.text(),
    /时间,号码\r\n2026-09-16T12:00:00\.000Z,13800138000/,
  );
  assert.match(
    exported.headers.get('content-disposition'),
    /visitor-phone-numbers\.csv/,
  );

  const logs = await request(
    '/integration/v1/phone-collection/download-logs',
    init,
  );
  const payload = await logs.json();
  assert.equal(payload.logs.length, 1);
  assert.equal(payload.logs[0].rowCount, 2);
  database.close();
});
