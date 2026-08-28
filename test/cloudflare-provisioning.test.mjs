import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CommandError,
  assertCloudflareCredentials,
  provisionCloudflareResources,
  readResourceDeclaration,
} from '../scripts/provision-cloudflare.mjs';

const portableConfig = {
  d1_databases: [
    {
      binding: 'DB',
      database_name: 'customer-service-db',
      migrations_dir: './migrations',
    },
  ],
  r2_buckets: [{ binding: 'MEDIA', bucket_name: 'customer-service-media' }],
};

test('portable resource declarations reject account-bound D1 ids', () => {
  assert.deepEqual(readResourceDeclaration(portableConfig), {
    databaseName: 'customer-service-db',
    bucketName: 'customer-service-media',
  });
  assert.throws(
    () =>
      readResourceDeclaration({
        ...portableConfig,
        d1_databases: [
          {
            ...portableConfig.d1_databases[0],
            database_id: '75ad7759-b287-45fe-9905-cd9e7971c7e0',
          },
        ],
      }),
    /Do not commit an account-bound D1 database_id/u,
  );
});

test('provisioning reuses existing D1 and R2 resources', async () => {
  const created = [];
  const messages = [];
  const capture = async (_command, args) => {
    if (args[0] === 'd1') {
      return { stdout: JSON.stringify([{ name: 'customer-service-db' }]) };
    }
    return { stdout: JSON.stringify({ name: 'customer-service-media' }) };
  };

  await provisionCloudflareResources({
    rawConfig: portableConfig,
    capture,
    run: async (_command, args) => created.push(args),
    log: (message) => messages.push(message),
  });

  assert.deepEqual(created, []);
  assert.deepEqual(messages, [
    'D1 customer-service-db: existing resource selected.',
    'R2 customer-service-media: existing resource selected.',
  ]);
});

test('provisioning creates only missing resources before deployment', async () => {
  const created = [];
  const capture = async (command, args) => {
    if (args[0] === 'd1') return { stdout: '[]' };
    throw new CommandError(
      command,
      args,
      1,
      '',
      'The R2 bucket does not exist [code: 10006]',
    );
  };

  await provisionCloudflareResources({
    rawConfig: portableConfig,
    capture,
    run: async (_command, args) => created.push(args),
    log: () => {},
  });

  assert.deepEqual(created, [
    ['d1', 'create', 'customer-service-db'],
    ['r2', 'bucket', 'create', 'customer-service-media'],
  ]);
});

test('provisioning does not treat an R2 authorization failure as a missing bucket', async () => {
  const created = [];
  const capture = async (command, args) => {
    if (args[0] === 'd1') {
      return { stdout: JSON.stringify([{ name: 'customer-service-db' }]) };
    }
    throw new CommandError(
      command,
      args,
      1,
      '',
      'Authentication error [code: 10000]',
    );
  };

  await assert.rejects(
    provisionCloudflareResources({
      rawConfig: portableConfig,
      capture,
      run: async (_command, args) => created.push(args),
      log: () => {},
    }),
    /failed with exit code 1/u,
  );
  assert.deepEqual(created, []);
});

test('provisioning requires only the two Cloudflare GitHub credentials', () => {
  assert.doesNotThrow(() =>
    assertCloudflareCredentials({
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_API_TOKEN: 'api-token',
    }),
  );
  assert.throws(
    () => assertCloudflareCredentials({ CLOUDFLARE_ACCOUNT_ID: 'account-id' }),
    /CLOUDFLARE_API_TOKEN is required/u,
  );
});
