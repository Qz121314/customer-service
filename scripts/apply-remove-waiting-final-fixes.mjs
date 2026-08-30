import { readFile, writeFile } from 'node:fs/promises';

const root = process.cwd();
const file = (path) => `${root}/${path}`;

async function read(path) {
  return readFile(file(path), 'utf8');
}

async function write(path, content) {
  return writeFile(file(path), content, 'utf8');
}

async function replaceOnce(path, from, to) {
  const source = await read(path);
  const first = source.indexOf(from);
  if (first < 0 || source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`Expected exactly one match in ${path}`);
  }
  await write(path, source.slice(0, first) + to + source.slice(first + from.length));
}

await replaceOnce(
  'src/worker/routing.ts',
  `export type AgentAssignment = {\n`,
  `type AssignmentOptions = {\n  onUnavailable?: 'reject' | 'close';\n};\n\nexport type AgentAssignment = {\n`,
);

await replaceOnce(
  'src/worker/routing.ts',
  `export async function assignConversationAgent(\n  db: D1Database,\n  conversationId: string,\n): Promise<AgentAssignmentResult | null> {`,
  `export async function assignConversationAgent(\n  db: D1Database,\n  conversationId: string,\n  options: AssignmentOptions = {},\n): Promise<AgentAssignmentResult | null> {`,
);

await replaceOnce(
  'src/worker/routing.ts',
  `    const unassigned = await db\n      .prepare(\n        \`SELECT c.site_id,\n           EXISTS (\n             SELECT 1\n             FROM agent_traffic_receipts receipt\n             WHERE receipt.conversation_id = c.id\n           ) AS already_received\n         FROM conversations c\n         WHERE c.id = ?1\n           AND c.assigned_agent IS NULL\n           AND c.status IN ('open', 'pending')\n         LIMIT 1\`,\n      )\n      .bind(conversationId)\n      .first<{ site_id: string; already_received: number }>();\n    if (!unassigned) return null;\n\n    if (Number(unassigned.already_received) > 0) {\n      await db\n        .prepare(\n          \`UPDATE conversations\n           SET status = 'closed', updated_at = CURRENT_TIMESTAMP\n           WHERE id = ?1\n             AND assigned_agent IS NULL\n             AND status IN ('open', 'pending')\`,\n        )\n        .bind(conversationId)\n        .run();\n      return null;\n    }\n\n    await db\n`,
  `    const unassigned = await db\n      .prepare(\n        \`SELECT c.site_id\n         FROM conversations c\n         WHERE c.id = ?1\n           AND c.assigned_agent IS NULL\n           AND c.status IN ('open', 'pending')\n         LIMIT 1\`,\n      )\n      .bind(conversationId)\n      .first<{ site_id: string }>();\n    if (!unassigned) return null;\n\n    if (options.onUnavailable === 'close') {\n      await db\n        .prepare(\n          \`UPDATE conversations\n           SET status = 'closed', updated_at = CURRENT_TIMESTAMP\n           WHERE id = ?1\n             AND assigned_agent IS NULL\n             AND status IN ('open', 'pending')\`,\n        )\n        .bind(conversationId)\n        .run();\n      return null;\n    }\n\n    await db\n`,
);

await replaceOnce(
  'src/worker/admin-config-api.ts',
  `        const assignment = await assignConversationAgent(\n          c.env.DB,\n          conversationId,\n        );`,
  `        const assignment = await assignConversationAgent(\n          c.env.DB,\n          conversationId,\n          { onUnavailable: 'close' },\n        );`,
);

await replaceOnce(
  'test/no-waiting-mode.test.mjs',
  `    CREATE TABLE conversations (\n      id TEXT PRIMARY KEY,\n      assigned_agent TEXT,\n      status TEXT NOT NULL\n    );\n`,
  `    CREATE TABLE agents (\n      id TEXT PRIMARY KEY\n    );\n    CREATE TABLE conversations (\n      id TEXT PRIMARY KEY,\n      assigned_agent TEXT REFERENCES agents(id),\n      status TEXT NOT NULL\n    );\n`,
);
await replaceOnce(
  'test/no-waiting-mode.test.mjs',
  `    INSERT INTO sites (id, name, public_key) VALUES ('default', 'Default', 'pk');\n    INSERT INTO conversations (id, assigned_agent, status) VALUES\n`,
  `    INSERT INTO sites (id, name, public_key) VALUES ('default', 'Default', 'pk');\n    INSERT INTO agents (id) VALUES ('agent-a');\n    INSERT INTO conversations (id, assigned_agent, status) VALUES\n`,
);

console.log('Explicit unavailable-routing fixes applied.');
