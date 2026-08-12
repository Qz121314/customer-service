import fs from 'node:fs';

const databaseId = process.argv[2];
if (!databaseId) {
  throw new Error(
    'Usage: node scripts/write-production-config.mjs <database-id>',
  );
}

const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
config.d1_databases[0].database_id = databaseId;
fs.writeFileSync(
  'wrangler.production.json',
  `${JSON.stringify(config, null, 2)}\n`,
);
console.log(`Generated production Wrangler config for D1 ${databaseId}.`);
