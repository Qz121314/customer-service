import { Hono } from 'hono';
import { broadcastClientConversationEvent } from './client-api';
import { verifyAdminSession } from './core';
import { assignConversationAgent } from './routing';

type Bindings = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
};

type Env = { Bindings: Bindings };

export const adminAgentDeleteApi = new Hono<Env>();

adminAgentDeleteApi.delete('/api/admin/agents/:id', async (c) => {
  const password = c.env.ADMIN_PASSWORD;
  if (!password || !(await verifyAdminSession(c.req.raw, password))) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const agentId = c.req.param('id').trim();
  if (!agentId || agentId === 'admin') {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  const agent = await c.env.DB.prepare(
    `SELECT id
     FROM agents
     WHERE id = ?1 AND site_id = 'default'
     LIMIT 1`,
  )
    .bind(agentId)
    .first<{ id: string }>();
  if (!agent) return c.json({ error: 'NOT_FOUND' }, 404);

  const activeResult = await c.env.DB.prepare(
    `SELECT id
     FROM conversations
     WHERE assigned_agent = ?1
       AND status IN ('open', 'pending')
       AND expires_at > CURRENT_TIMESTAMP
     ORDER BY last_message_at ASC, id ASC`,
  )
    .bind(agentId)
    .all<{ id: string }>();
  const conversationIds = (activeResult.results ?? []).map(
    (conversation) => conversation.id,
  );

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE conversations
       SET assigned_agent = NULL,
           assigned_at = NULL,
           assigned_business_date = NULL,
           status = 'open',
           updated_at = CURRENT_TIMESTAMP
       WHERE assigned_agent = ?1
         AND status IN ('open', 'pending')
         AND expires_at > CURRENT_TIMESTAMP`,
    ).bind(agentId),
    c.env.DB.prepare(
      `UPDATE conversations
       SET cta_affinity_agent_id = NULL,
           cta_affinity_expires_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE cta_affinity_agent_id = ?1`,
    ).bind(agentId),
    c.env.DB.prepare(
      `DELETE FROM agents
       WHERE id = ?1 AND site_id = 'default'`,
    ).bind(agentId),
  ]);

  await disconnectAgentRealtime(c.env, agentId, conversationIds);

  let reassignedConversationCount = 0;
  for (const conversationId of conversationIds) {
    const assignment = await assignConversationAgent(c.env.DB, conversationId);
    if (assignment) reassignedConversationCount += 1;
    await broadcastClientConversationEvent(
      c.env,
      conversationId,
      'conversation.assigned',
    );
  }

  return c.json({
    ok: true,
    releasedConversationCount: conversationIds.length,
    reassignedConversationCount,
  });
});

async function disconnectAgentRealtime(
  env: Bindings,
  agentId: string,
  conversationIds: string[],
): Promise<void> {
  const roomIds = [`agent-inbox:${agentId}`, ...conversationIds];
  await Promise.all(
    roomIds.map((roomId) =>
      env.CONVERSATION_ROOMS.get(
        env.CONVERSATION_ROOMS.idFromName(roomId),
      ).fetch('https://conversation-room/disconnect-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      }),
    ),
  );
}
