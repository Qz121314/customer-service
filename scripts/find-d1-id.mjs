import fs from 'node:fs';

const name = process.argv[2];
if (!name) process.exit(2);

const input = fs.readFileSync(0, 'utf8').trim();
if (!input) process.exit(1);

let data;
try {
  data = JSON.parse(input);
} catch {
  const start = Math.min(
    ...['[', '{'].map((token) => {
      const index = input.indexOf(token);
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    }),
  );
  if (!Number.isFinite(start)) process.exit(1);
  data = JSON.parse(input.slice(start));
}

const values = Array.isArray(data) ? data : [data];
const match = values.find(
  (item) => item?.name === name || item?.database_name === name || item?.title === name,
);
const id = match?.uuid ?? match?.id ?? match?.database_id;
if (!id) process.exit(1);
process.stdout.write(String(id));
