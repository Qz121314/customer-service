from pathlib import Path

client = Path("src/worker/client-api.ts")
client_text = client.read_text()

old_replay = """  const existing = await c.env.DB.prepare(
    `SELECT m.conversation_id
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     JOIN visitors v ON v.id = c.visitor_id
     WHERE c.site_id = ?1 AND v.external_id = ?2 AND m.client_message_id = ?3
     LIMIT 1`,
  )
    .bind(site.id, visitorId, clientMessageId)
    .first<{ conversation_id: string }>();
  if (existing) {
    const conversation = await ownedConversation(
      c.env.DB,
      existing.conversation_id,
      site.id,
      visitorId,
    );
    if (conversation) {
      return c.json({
        conversation: await conversationDetail(
          c.env.DB,
          conversation,
          30,
          null,
        ),
      });
    }
  }

  const existingHandoff = await c.env.DB.prepare(
    `SELECT c.id, v.external_id
     FROM conversations c
     JOIN visitors v ON v.id = c.visitor_id
     WHERE c.site_id = ?1 AND c.source_handoff_id = ?2
     LIMIT 1`,
  )
    .bind(site.id, sourceHandoffId)
    .first<{ id: string; external_id: string }>();
  if (existingHandoff?.external_id !== undefined) {
    if (existingHandoff.external_id !== visitorId) {
      return error(
        c,
        409,
        'SOURCE_HANDOFF_ALREADY_USED',
        'Source handoff ID was already used.',
      );
    }
    const conversation = await ownedConversation(
      c.env.DB,
      existingHandoff.id,
      site.id,
      visitorId,
    );
    if (conversation) {
      return c.json({
        conversation: await conversationDetail(
          c.env.DB,
          conversation,
          30,
          null,
        ),
      });
    }
  }
"""
new_replay = """  const replay = await c.env.DB.prepare(
    `WITH message_match AS (
       SELECT m.conversation_id
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.site_id = ?1
         AND v.external_id = ?2
         AND m.client_message_id = ?3
       LIMIT 1
     ),
     handoff_match AS (
       SELECT c.id AS conversation_id, v.external_id
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.site_id = ?1 AND c.source_handoff_id = ?4
       LIMIT 1
     )
     SELECT
       (SELECT conversation_id FROM message_match) AS message_conversation_id,
       (SELECT conversation_id FROM handoff_match) AS handoff_conversation_id,
       (SELECT external_id FROM handoff_match) AS handoff_external_id`,
  )
    .bind(site.id, visitorId, clientMessageId, sourceHandoffId)
    .first<{
      message_conversation_id: string | null;
      handoff_conversation_id: string | null;
      handoff_external_id: string | null;
    }>();

  if (replay?.message_conversation_id) {
    const conversation = await ownedConversation(
      c.env.DB,
      replay.message_conversation_id,
      site.id,
      visitorId,
    );
    if (conversation) {
      return c.json({
        conversation: await conversationDetail(
          c.env.DB,
          conversation,
          30,
          null,
        ),
      });
    }
  }

  if (replay?.handoff_conversation_id) {
    if (replay.handoff_external_id !== visitorId) {
      return error(
        c,
        409,
        'SOURCE_HANDOFF_ALREADY_USED',
        'Source handoff ID was already used.',
      );
    }
    const conversation = await ownedConversation(
      c.env.DB,
      replay.handoff_conversation_id,
      site.id,
      visitorId,
    );
    if (conversation) {
      return c.json({
        conversation: await conversationDetail(
          c.env.DB,
          conversation,
          30,
          null,
        ),
      });
    }
  }
"""
if client_text.count(old_replay) != 1:
    raise SystemExit(f"client-api.ts: replay block mismatch ({client_text.count(old_replay)})")
client_text = client_text.replace(old_replay, new_replay, 1)

old_product_tail = """         category_name = excluded.category_name,
         is_enabled = 1,
         updated_at = CURRENT_TIMESTAMP`,"""
new_product_tail = """         category_name = excluded.category_name,
         is_enabled = 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE title IS NOT excluded.title
          OR href IS NOT excluded.href
          OR cover_url IS NOT excluded.cover_url
          OR section_id IS NOT excluded.section_id
          OR section_name IS NOT excluded.section_name
          OR category_id IS NOT excluded.category_id
          OR category_name IS NOT excluded.category_name
          OR is_enabled <> 1`,"""
if client_text.count(old_product_tail) != 1:
    raise SystemExit("client-api.ts: product upsert tail mismatch")
client_text = client_text.replace(old_product_tail, new_product_tail, 1)

ensure_start = client_text.index("async function ensureVisitor(")
ensure_end = client_text.index("async function resolveIdentity(", ensure_start)
new_ensure = """async function ensureVisitor(
  db: D1Database,
  siteId: string,
  externalId: string,
): Promise<VisitorRow> {
  const id = crypto.randomUUID();
  const tokenHash = await sha256(
    `client-v1:${siteId}:${externalId}:${crypto.randomUUID()}`,
  );
  const expiresAt = conversationExpiresAt(new Date());
  const result = await db
    .prepare(
      `INSERT INTO visitors (
       id, site_id, token_hash, display_name, external_id, expires_at
     ) VALUES (?1, ?2, ?3, ?4, ?4, ?5)
     ON CONFLICT(site_id, external_id) DO UPDATE SET
       last_seen_at = CURRENT_TIMESTAMP,
       expires_at = excluded.expires_at
     RETURNING id, site_id, external_id, expires_at`,
    )
    .bind(id, siteId, tokenHash, externalId, expiresAt)
    .all<VisitorRow>();

  const visitor = result.results?.[0];
  if (!visitor) throw new Error('Visitor persistence failed');
  return visitor;
}

"""
client_text = client_text[:ensure_start] + new_ensure + client_text[ensure_end:]

old_create_tail = """  await broadcastClientConversationEvent(
    c.env,
    conversationId,
    'message.created',
    {
      message: clientMessage(createdMessage),
    },
    { includeOverview: Boolean(assignment) },
  );

  const conversation = await ownedConversation(
    c.env.DB,
    conversationId,
    site.id,
    visitorId,
  );
  if (!conversation) throw new Error('Conversation persistence failed');

  return c.json(
    {
      conversation: await conversationDetail(c.env.DB, conversation, 30, null),
    },
    201,
  );"""
new_create_tail = """  const conversation = await broadcastClientConversationEvent(
    c.env,
    conversationId,
    'message.created',
    {
      message: clientMessage(createdMessage),
    },
    { includeOverview: Boolean(assignment) },
  );
  if (!conversation) throw new Error('Conversation persistence failed');

  return c.json(
    {
      conversation: await conversationDetail(c.env.DB, conversation, 30, null),
    },
    201,
  );"""
if client_text.count(old_create_tail) != 1:
    raise SystemExit(f"client-api.ts: create response tail mismatch ({client_text.count(old_create_tail)})")
client_text = client_text.replace(old_create_tail, new_create_tail, 1)

broadcast_start = client_text.index("export async function broadcastClientConversationEvent(")
broadcast_end = client_text.index("async function loadAgentOverview(", broadcast_start)
broadcaster = client_text[broadcast_start:broadcast_end]
if broadcaster.count("): Promise<void> {") != 1:
    raise SystemExit("client-api.ts: broadcaster signature mismatch")
broadcaster = broadcaster.replace(
    "): Promise<void> {", "): Promise<ConversationRow | null> {", 1
)
if broadcaster.count("  if (!conversation) return;\n") != 1:
    raise SystemExit("client-api.ts: broadcaster missing conversation guard")
broadcaster = broadcaster.replace(
    "  if (!conversation) return;\n", "  if (!conversation) return null;\n", 1
)
if broadcaster.count("  if (!conversation.assigned_agent) return;\n") != 1:
    raise SystemExit("client-api.ts: broadcaster missing assignment guard")
broadcaster = broadcaster.replace(
    "  if (!conversation.assigned_agent) return;\n",
    "  if (!conversation.assigned_agent) return conversation;\n",
    1,
)
broadcast_tail = """  await broadcastRoom(env, agentInboxRoom(conversation.assigned_agent), {
    type: 'conversation.changed',
    conversationId,
    conversation: agentConversationSummary(conversation),
    ...(overview ? { overview } : {}),
  });
}

"""
broadcast_tail_new = """  await broadcastRoom(env, agentInboxRoom(conversation.assigned_agent), {
    type: 'conversation.changed',
    conversationId,
    conversation: agentConversationSummary(conversation),
    ...(overview ? { overview } : {}),
  });
  return conversation;
}

"""
if broadcaster.count(broadcast_tail) != 1:
    raise SystemExit("client-api.ts: broadcaster tail mismatch")
broadcaster = broadcaster.replace(broadcast_tail, broadcast_tail_new, 1)
client_text = client_text[:broadcast_start] + broadcaster + client_text[broadcast_end:]
client.write_text(client_text)

Path("src/worker/routing.ts").write_text("""export type AgentAssignment = {
  id: string;
  name: string;
};

type AgentAssignmentRow = AgentAssignment & {
  site_id: string;
};

const ROUTING_TIME_ZONE = 'America/Los_Angeles';

export function routingBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROUTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Assign one conversation to one currently-eligible agent.
 *
 * Routing is scope-native: product, section and category scopes are the only
 * assignment source. Candidate selection and the conversation write happen in
 * the same SQLite UPDATE statement, so concurrent requests cannot both pass a
 * stale capacity check before writing. Active load is balanced first; today's
 * accepted count is a secondary fairness signal; last_assigned_at and id make
 * equal-load ordering deterministic.
 */
export async function assignConversationAgent(
  db: D1Database,
  conversationId: string,
  excludedAgentId: string | null = null,
): Promise<AgentAssignment | null> {
  const now = new Date().toISOString();
  const businessDate = routingBusinessDate(new Date(now));
  const result = await db
    .prepare(
      `WITH context AS (
         SELECT
           c.site_id,
           c.product_id,
           COALESCE(c.section_id, p.section_id) AS section_id,
           COALESCE(c.category_id, p.category_id) AS category_id
         FROM conversations c
         LEFT JOIN product_catalog p
           ON p.site_id = c.site_id
          AND p.id = c.product_id
         WHERE c.id = ?1
           AND c.assigned_agent IS NULL
           AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
         LIMIT 1
       ),
       matching AS (
         SELECT DISTINCT ars.agent_id
         FROM agent_routing_scopes ars
         JOIN context ctx ON ctx.site_id = ars.site_id
         WHERE ars.is_enabled = 1
           AND (
             (
               COALESCE(ctx.product_id, '') <> ''
               AND ars.scope_type = 'product'
               AND ars.product_id = ctx.product_id
             )
             OR (
               COALESCE(ctx.section_id, '') <> ''
               AND ars.scope_type = 'section'
               AND ars.section_id = ctx.section_id
             )
             OR (
               COALESCE(ctx.section_id, '') <> ''
               AND COALESCE(ctx.category_id, '') <> ''
               AND ars.scope_type = 'category'
               AND ars.section_id = ctx.section_id
               AND ars.category_id = ctx.category_id
             )
           )
       ),
       load AS (
         SELECT c.assigned_agent, COUNT(*) AS active_count
         FROM conversations c
         JOIN matching m ON m.agent_id = c.assigned_agent
         JOIN context ctx ON ctx.site_id = c.site_id
         WHERE c.status IN ('open', 'pending')
           AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
         GROUP BY c.assigned_agent
       ),
       candidate AS (
         SELECT a.id
         FROM matching m
         JOIN agents a ON a.id = m.agent_id
         JOIN context ctx ON ctx.site_id = a.site_id
         LEFT JOIN load ON load.assigned_agent = a.id
         LEFT JOIN agent_daily_stats daily
           ON daily.site_id = a.site_id
          AND daily.agent_id = a.id
          AND daily.business_date = ?3
         WHERE a.is_enabled = 1
           AND (?4 = '' OR a.id <> ?4)
           AND a.status = 'online'
           AND a.username IS NOT NULL
           AND a.password_hash IS NOT NULL
           AND a.last_seen_at IS NOT NULL
           AND datetime(a.last_seen_at) >= datetime('now', '-2 minutes')
           AND (
             a.max_active_conversations = 0
             OR COALESCE(load.active_count, 0) < a.max_active_conversations
           )
           AND (
             a.daily_conversation_limit = 0
             OR COALESCE(daily.conversation_count, 0) < a.daily_conversation_limit
           )
           AND (
             a.traffic_quota_enabled = 0
             OR a.traffic_quota_used < a.traffic_quota_total
           )
         ORDER BY
           COALESCE(load.active_count, 0) ASC,
           COALESCE(daily.conversation_count, 0) ASC,
           COALESCE(a.last_assigned_at, '') ASC,
           a.id ASC
         LIMIT 1
       )
       UPDATE conversations
       SET assigned_agent = (SELECT id FROM candidate),
           assigned_at = ?2,
           assigned_business_date = ?3,
           status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
           updated_at = ?2
       WHERE id = ?1
         AND assigned_agent IS NULL
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
         AND EXISTS (SELECT 1 FROM candidate)
       RETURNING assigned_agent AS id,
         (SELECT name FROM agents WHERE id = assigned_agent LIMIT 1) AS name,
         site_id`,
    )
    .bind(conversationId, now, businessDate, excludedAgentId ?? '')
    .all<AgentAssignmentRow>();

  const assignment = result.results?.[0];
  if (!assignment) return assignedAgent(db, conversationId);

  await db
    .prepare(
      `UPDATE agents
       SET last_assigned_at = ?1, updated_at = ?1
       WHERE id = ?2 AND site_id = ?3`,
    )
    .bind(now, assignment.id, assignment.site_id)
    .run();

  return { id: assignment.id, name: assignment.name };
}

async function assignedAgent(
  db: D1Database,
  conversationId: string,
): Promise<AgentAssignment | null> {
  return db
    .prepare(
      `SELECT a.id, a.name
       FROM conversations c
       JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id
       WHERE c.id = ?1
       LIMIT 1`,
    )
    .bind(conversationId)
    .first<AgentAssignment>();
}
""")

Path("test/conversation-create-d1-cost.test.mjs").write_text("""import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const clientSource = readFileSync('src/worker/client-api.ts', 'utf8');
const routingSource = readFileSync('src/worker/routing.ts', 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test('new conversation replay checks share one D1 statement', () => {
  const route = section(
    clientSource,
    "clientApi.post('/client/v1/conversations'",
    "clientApi.post('/client/v1/conversations/:id/messages'",
  );

  assert.match(route, /WITH message_match AS/u);
  assert.match(route, /handoff_match AS/u);
  assert.match(route, /message_conversation_id/u);
  assert.match(route, /handoff_conversation_id/u);
  assert.doesNotMatch(route, /const existingHandoff = await c\\.env\\.DB\\.prepare/u);
});

test('visitor upsert keeps returning visitors to one D1 statement', () => {
  const helper = section(
    clientSource,
    'async function ensureVisitor(',
    'async function resolveIdentity(',
  );

  assert.match(helper, /ON CONFLICT\\(site_id, external_id\\) DO UPDATE SET/u);
  assert.match(helper, /RETURNING id, site_id, external_id, expires_at/u);
  assert.doesNotMatch(helper, /SELECT id, site_id, external_id/u);
  assert.equal((helper.match(/\\.prepare\\(/gu) ?? []).length, 1);
});

test('stable product routing context avoids unnecessary writes', () => {
  const helper = section(
    clientSource,
    'async function rememberProductRoutingContext(',
    'async function ensureVisitor(',
  );

  assert.match(helper, /WHERE title IS NOT excluded\\.title/u);
  assert.match(helper, /category_name IS NOT excluded\\.category_name/u);
  assert.match(helper, /OR is_enabled <> 1/u);
});

test('new conversation response reuses the broadcaster conversation read', () => {
  const route = section(
    clientSource,
    'const assignment = await assignConversationAgent',
    "clientApi.post('/client/v1/conversations/:id/messages'",
  );
  const broadcaster = section(
    clientSource,
    'export async function broadcastClientConversationEvent(',
    'async function loadAgentOverview(',
  );

  assert.match(route, /const conversation = await broadcastClientConversationEvent/u);
  assert.doesNotMatch(route, /await ownedConversation\\(/u);
  assert.match(broadcaster, /Promise<ConversationRow \\| null>/u);
  assert.match(broadcaster, /return conversation;/u);
});

test('normal routing assignment keeps only the assignment and agent-touch statements', () => {
  const route = section(
    routingSource,
    'export async function assignConversationAgent(',
    'async function assignedAgent(',
  );

  assert.match(route, /WITH context AS/u);
  assert.match(route, /JOIN matching m ON m\\.agent_id = c\\.assigned_agent/u);
  assert.match(route, /RETURNING assigned_agent AS id/u);
  assert.doesNotMatch(route, /const conversation = await db/u);
  assert.equal((route.match(/\\.prepare\\(/gu) ?? []).length, 2);
});
""")
