import { readFile, writeFile } from 'node:fs/promises';

const root = process.cwd();
const file = (path) => `${root}/${path}`;

async function replaceOnce(path, from, to) {
  const source = await readFile(file(path), 'utf8');
  const first = source.indexOf(from);
  if (first < 0 || source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`Expected exactly one match in ${path}`);
  }
  await writeFile(
    file(path),
    source.slice(0, first) + to + source.slice(first + from.length),
    'utf8',
  );
}

await replaceOnce(
  'src/worker/agent-api.ts',
  `  if (body.status === 'closed') {
    await assignWaitingConversations(c.env, agent.id);
  }
`,
  '',
);

await replaceOnce(
  'test/legacy-routing-removal.test.mjs',
  `  const routing = workerSource('routing.ts');
  const waiting = workerSource('waiting-assignment.ts');
  const entry = workerSource('entry.ts');

  for (const source of [clientApi, integrationApi, routing, waiting]) {
`,
  `  const routing = workerSource('routing.ts');
  const entry = workerSource('entry.ts');

  for (const source of [clientApi, integrationApi, routing]) {
`,
);

console.log('Remaining waiting references removed.');
