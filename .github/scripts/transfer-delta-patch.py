from pathlib import Path

agent_path = Path('src/worker/agent-api.ts')
agent = agent_path.read_text()

marker = "type QuickReplyRow = {\n"
insert = "type TransferConversationRow = {\n  site_id: string;\n  status: ConversationStatus;\n};\n\n"
assert marker in agent and insert not in agent
agent = agent.replace(marker, insert + marker, 1)

old = "  const conversation = await assignedConversation(c.env.DB, id, agent.id);\n"
new = "  const conversation = await assignedConversationForTransfer(\n    c.env.DB,\n    id,\n    agent.id,\n  );\n"
assert agent.count(old) == 1
agent = agent.replace(old, new, 1)

start = agent.index("    const transfer = await c.env.DB.prepare(\n      `UPDATE conversations")
end = agent.index("\n\n    await c.env.DB.prepare(\n      `UPDATE agents", start)
replacement = '''    const transfer = await c.env.DB.prepare(
      `UPDATE conversations
       SET assigned_agent = ?1,
           assigned_at = ?2,
           assigned_business_date = ?3,
           status = 'pending',
           updated_at = ?2
       WHERE id = ?4
         AND assigned_agent = ?5
         AND status IN ('open', 'pending')
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
         AND EXISTS (
           SELECT 1
           FROM agents target
           LEFT JOIN agent_daily_stats daily
             ON daily.site_id = target.site_id
            AND daily.agent_id = target.id
            AND daily.business_date = ?3
           WHERE target.id = ?1
             AND target.site_id = ?6
             AND target.is_enabled = 1
             AND target.status = 'online'
             AND target.username IS NOT NULL
             AND target.password_hash IS NOT NULL
             AND target.last_seen_at IS NOT NULL
             AND datetime(target.last_seen_at) >= datetime('now', '-2 minutes')
             AND (
               target.max_active_conversations = 0
               OR (
                 SELECT COUNT(*)
                 FROM conversations load
                 WHERE load.assigned_agent = target.id
                   AND load.status IN ('open', 'pending')
                   AND COALESCE(load.expires_at, datetime(load.created_at, '+1 day')) > CURRENT_TIMESTAMP
               ) < target.max_active_conversations
             )
             AND (
               target.daily_conversation_limit = 0
               OR COALESCE(daily.conversation_count, 0) < target.daily_conversation_limit
             )
             AND (
               target.traffic_quota_enabled = 0
               OR target.traffic_quota_used < target.traffic_quota_total
             )
         )
       RETURNING assigned_agent AS id,
         (SELECT name FROM agents WHERE id = assigned_agent LIMIT 1) AS name`,
    )
      .bind(
        targetAgentId,
        now,
        businessDate,
        id,
        agent.id,
        conversation.site_id,
      )
      .first<{ id: string; name: string }>();
    if (!transfer)
      return c.json({ error: 'TRANSFER_TARGET_UNAVAILABLE' }, 409);'''
agent = agent[:start] + replacement + agent[end:]

old = "    assignment = await c.env.DB.prepare(\n      'SELECT id, name FROM agents WHERE id = ?1 LIMIT 1',\n    )\n      .bind(targetAgentId)\n      .first<{ id: string; name: string }>();\n"
new = "    assignment = { id: transfer.id, name: transfer.name };\n"
assert agent.count(old) == 1
agent = agent.replace(old, new, 1)

start = agent.index("  const realtimeUpdates: Promise<void>[] = [", agent.index("agentApi.post('/api/agent/conversations/:id/transfer'"))
end = agent.index("  await Promise.all(realtimeUpdates);", start)
replacement = '''  const realtimeUpdates: Promise<void>[] = [
    broadcastConversationRoom(c.env, id, {
      type: 'conversation.transferred',
      assignment,
    }),
    broadcastClientConversationEvent(
      c.env,
      id,
      'conversation.assigned',
      {},
      { previousAgentId: agent.id },
    ).then(() => undefined),
  ];
'''
agent = agent[:start] + replacement + agent[end:]

marker = "async function assignedConversation(\n"
helper = '''async function assignedConversationForTransfer(
  db: D1Database,
  id: string,
  agentId: string,
): Promise<TransferConversationRow | null> {
  return db
    .prepare(
      `SELECT site_id, status
       FROM conversations
       WHERE id = ?1 AND assigned_agent = ?2
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
       LIMIT 1`,
    )
    .bind(id, agentId)
    .first<TransferConversationRow>();
}

'''
assert marker in agent and helper not in agent
agent = agent.replace(marker, helper + marker, 1)

start = agent.index("async function broadcastAgentInboxRefresh(\n")
end = agent.index("function unauthorized(", start)
agent = agent[:start] + agent[end:]
agent_path.write_text(agent)

client_path = Path('src/worker/client-api.ts')
client = client_path.read_text()
old = "  options: { includeOverview?: boolean } = {},\n"
new = "  options: {\n    includeOverview?: boolean;\n    previousAgentId?: string | null;\n  } = {},\n"
assert client.count(old) == 1
client = client.replace(old, new, 1)

old = '''  if (!conversation.assigned_agent) return conversation;

  const includeOverview =
    options.includeOverview ??
    (type === 'conversation.assigned' || type === 'conversation.closed');
  const overview = includeOverview
    ? await loadAgentOverview(env.DB, conversation.assigned_agent)
    : null;
  await broadcastRoom(env, agentInboxRoom(conversation.assigned_agent), {
    type: 'conversation.changed',
    conversationId,
    conversation: agentConversationSummary(conversation),
    ...(overview ? { overview } : {}),
  });
  return conversation;
'''
new = '''  const previousAgentId =
    options.previousAgentId &&
    options.previousAgentId !== conversation.assigned_agent
      ? options.previousAgentId
      : null;
  const includeOverview =
    options.includeOverview ??
    (type === 'conversation.assigned' || type === 'conversation.closed');
  const [overview, previousOverview] = await Promise.all([
    conversation.assigned_agent && includeOverview
      ? loadAgentOverview(env.DB, conversation.assigned_agent)
      : Promise.resolve(null),
    previousAgentId
      ? loadAgentOverview(env.DB, previousAgentId)
      : Promise.resolve(null),
  ]);
  const inboxUpdates: Promise<void>[] = [];
  if (conversation.assigned_agent) {
    inboxUpdates.push(
      broadcastRoom(env, agentInboxRoom(conversation.assigned_agent), {
        type: 'conversation.changed',
        conversationId,
        conversation: agentConversationSummary(conversation),
        ...(overview ? { overview } : {}),
      }),
    );
  }
  if (previousAgentId) {
    inboxUpdates.push(
      broadcastRoom(env, agentInboxRoom(previousAgentId), {
        type: 'conversation.changed',
        conversationId,
        conversation: agentConversationSummary(conversation),
        ...(previousOverview ? { overview: previousOverview } : {}),
      }),
    );
  }
  await Promise.all(inboxUpdates);
  return conversation;
'''
assert client.count(old) == 1
client = client.replace(old, new, 1)
client_path.write_text(client)

test_path = Path('test/transfer-realtime-cost.test.mjs')
test_path.write_text(r'''import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('transfer sends incremental inbox deltas instead of forcing full refreshes', () => {
  const agent = source('../src/worker/agent-api.ts');
  const client = source('../src/worker/client-api.ts');
  const portal = source('../src/dashboard/AgentPortal.tsx');
  const start = agent.indexOf(
    "agentApi.post('/api/agent/conversations/:id/transfer'",
  );
  const end = agent.indexOf("agentApi.get('/api/agent/realtime/inbox'", start);
  assert.ok(start >= 0 && end > start);
  const transfer = agent.slice(start, end);

  assert.match(transfer, /previousAgentId: agent\.id/u);
  assert.doesNotMatch(transfer, /broadcastAgentInboxRefresh/u);
  assert.match(client, /agentInboxRoom\(previousAgentId\)/u);
  assert.match(client, /type: 'conversation\.changed'/u);
  assert.match(portal, /payload\.type !== 'conversation\.changed'/u);
  assert.match(portal, /if \(!belongsToAgent\) return withoutCurrent/u);
});

test('direct transfer returns the target identity from the assignment write', () => {
  const agent = source('../src/worker/agent-api.ts');
  const start = agent.indexOf(
    "agentApi.post('/api/agent/conversations/:id/transfer'",
  );
  const end = agent.indexOf("agentApi.get('/api/agent/realtime/inbox'", start);
  assert.ok(start >= 0 && end > start);
  const transfer = agent.slice(start, end);

  assert.match(transfer, /assignedConversationForTransfer/u);
  assert.match(transfer, /RETURNING assigned_agent AS id/u);
  assert.match(transfer, /assignment = \{ id: transfer\.id, name: transfer\.name \}/u);
  assert.doesNotMatch(
    transfer,
    /SELECT id, name FROM agents WHERE id = \?1 LIMIT 1/u,
  );
});
''')
