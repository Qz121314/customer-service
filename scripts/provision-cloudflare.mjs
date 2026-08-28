import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const WRANGLER_COMMAND =
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';

export class CommandError extends Error {
  constructor(command, args, exitCode, stdout, stderr) {
    super(
      `${command} ${args.join(' ')} failed with exit code ${String(exitCode)}.`,
    );
    this.name = 'CommandError';
    this.command = command;
    this.args = args;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export function readResourceDeclaration(rawConfig) {
  const databases = rawConfig.d1_databases ?? [];
  const buckets = rawConfig.r2_buckets ?? [];
  const database = databases.find((candidate) => candidate.binding === 'DB');
  const bucket = buckets.find((candidate) => candidate.binding === 'MEDIA');

  assert.ok(database, 'wrangler.jsonc must declare the DB D1 binding.');
  assert.ok(
    database.database_name,
    'The DB binding must declare a portable database_name.',
  );
  assert.equal(
    database.database_id,
    undefined,
    'Do not commit an account-bound D1 database_id; deployment resolves it by name.',
  );
  assert.ok(bucket, 'wrangler.jsonc must declare the MEDIA R2 binding.');
  assert.ok(
    bucket.bucket_name,
    'The MEDIA binding must declare a portable bucket_name.',
  );

  return {
    databaseName: database.database_name,
    bucketName: bucket.bucket_name,
  };
}

export function assertCloudflareCredentials(environment = process.env) {
  for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) {
    if (!environment[name]?.trim()) {
      throw new Error(`${name} is required for Cloudflare deployment.`);
    }
  }
}

export async function provisionCloudflareResources({
  rawConfig,
  capture = captureCommand,
  run = runCommand,
  log = console.log,
}) {
  const { databaseName, bucketName } = readResourceDeclaration(rawConfig);
  const databasesOutput = await capture(WRANGLER_COMMAND, [
    'd1',
    'list',
    '--json',
  ]);
  const databases = JSON.parse(databasesOutput.stdout);

  assert.ok(Array.isArray(databases), 'Wrangler returned an invalid D1 list.');
  if (databases.some((database) => database.name === databaseName)) {
    log(`D1 ${databaseName}: existing resource selected.`);
  } else {
    log(`D1 ${databaseName}: creating resource.`);
    await run(WRANGLER_COMMAND, ['d1', 'create', databaseName]);
  }

  try {
    await capture(WRANGLER_COMMAND, [
      'r2',
      'bucket',
      'info',
      bucketName,
      '--json',
    ]);
    log(`R2 ${bucketName}: existing resource selected.`);
  } catch (error) {
    if (!isMissingR2Bucket(error)) throw error;
    log(`R2 ${bucketName}: creating resource.`);
    await run(WRANGLER_COMMAND, ['r2', 'bucket', 'create', bucketName]);
  }

  return { databaseName, bucketName };
}

export function isMissingR2Bucket(error) {
  if (!(error instanceof CommandError)) return false;
  return /(?:code:\s*10006|\[code:\s*10006\]|R2 bucket[^\n]*does(?:n't| not) exist|specified bucket does not exist)/iu.test(
    `${error.stdout}\n${error.stderr}`,
  );
}

export async function captureCommand(command, args) {
  return executeCommand(command, args, false);
}

export async function runCommand(command, args) {
  return executeCommand(command, args, true);
}

async function executeCommand(command, args, inheritOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: inheritOutput ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    if (!inheritOutput) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
    }

    child.on('error', reject);
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new CommandError(command, args, exitCode, stdout, stderr));
    });
  });
}

async function main() {
  assertCloudflareCredentials();
  const { experimental_readRawConfig } = await import('wrangler');
  const { rawConfig } = await experimental_readRawConfig({
    config: 'wrangler.jsonc',
  });
  const resources = await provisionCloudflareResources({ rawConfig });
  console.log(
    `Cloudflare storage ready: D1=${resources.databaseName} R2=${resources.bucketName}`,
  );
}

const entryPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
if (entryPath === import.meta.url) {
  try {
    await main();
  } catch (error) {
    if (error instanceof CommandError) {
      console.error(error.message);
      if (error.stdout.trim()) console.error(error.stdout.trim());
      if (error.stderr.trim()) console.error(error.stderr.trim());
      if (/\bR2\b|r2\/buckets/iu.test(`${error.stdout}\n${error.stderr}`)) {
        console.error(
          'If this is a new Cloudflare account, activate the R2 subscription in the Cloudflare dashboard before rerunning the workflow.',
        );
      }
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  }
}
