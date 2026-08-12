import fs from 'node:fs';

const databaseId = process.argv[2];
if (!databaseId) {
  throw new Error(
    'Usage: node scripts/write-production-config.mjs <database-id>',
  );
}

const placeholder = '00000000-0000-0000-0000-000000000001';
const source = fs.readFileSync('wrangler.jsonc', 'utf8');
if (!source.includes(placeholder)) {
  throw new Error('D1 placeholder was not found in wrangler.jsonc');
}

const productionConfig = source.replace(placeholder, databaseId);
fs.writeFileSync('wrangler.production.jsonc', productionConfig);
console.log(`Generated production Wrangler config for D1 ${databaseId}.`);
