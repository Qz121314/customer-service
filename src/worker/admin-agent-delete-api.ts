import { Hono } from 'hono';
import { broadcastClientConversationEvent } from './client-api';
import { verifyAdminSession } from './core';
import { assignConversationAgent } from './routing';

type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  CONVERSATION_ROOMS: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
};

type Env = { Bindings: Bindings };

type AgentDeleteRow = {
  id: string;
  name: string;
};

const AVATAR_KEY_PREFIX = 'agent-avatars';

export const adminAgentDeleteApi = new Hono<Env>();

adminAgentDeleteApi.delete('/api/admin/agents/:id', async (c) => {
  const password = c.env.ADMIN_PASSWORD;
  if (!password || !(await verifyAdminSession(c.req.raw, password))) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const id = c.req.param('id').trim();
  if (!id || id === 'admin') return c.json({ error: 'NOT_FOUND' }, 404);

  const agent = await c.env.DB.prepare(
    `SELECT id, name
     FROM agents
     WHERE id = ?1 AND site_id = 'default'
     LIMIT 1`,
  )
    .bind(id)
    .first<AgentDeleteRow>();
  if (!agent) return c.json({ error: 'NOT_FOUND' }, 404);

  const revoked = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE agents
       SET is_enabled = 0,
           status = 'offline',
           last_seen_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND site_id = 'default'`,
    ).bind(id),
    c.env.DB.prepare('DELETE FROM agent_sessions WHERE agent_id = ?1').bind(id),
  ]);
  if (Number(revoked[0]?.meta?.changes ?? 0) !== 1) {
    return c.json({ error: 'AGENT_DELETE_FAILED' }, 500);
  }

  const activeConversationIds = await assignedActiveConversationIds(c.env.DB, id);
  const results = await c.env.DB.batch([
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
    ).bind(id),
    c.env.DB.prepare(
      `DELETE FROM agents
       WHERE id = ?1 AND site_id = 'default'`,
    ).bind(id),
  ]);

  if (Number(results[1]?.meta?.changes ?? 0) !== 1) {
    return c.json({ error: 'AGENT_DELETE_FAILED' }, 500);
  }

  try {
    await disconnectAgentRealtime(c.env, id, activeConversationIds);
  } catch (error) {
    console.warn('agent.delete.realtime_disconnect_failed', {
      agentId: id,
      error,
    });
  }

  let reassignedCount = 0;
  for (const conversationId of activeConversationIds) {
    try {
      const assignment = await assignConversationAgent(c.env.DB, conversationId);
      if (assignment) reassignedCount += 1;
      await broadcastClientConversationEvent(
        c.env,
        conversationId,
        'conversation.assigned',
      );
    } catch (error) {
      console.warn('agent.delete.conversation_reassign_failed', {
        agentId: id,
        conversationId,
        error,
      });
    }
  }

  try {
    await c.env.MEDIA.delete(`${AVATAR_KEY_PREFIX}/${id}/current`);
  } catch (error) {
    console.warn('agent.delete.avatar_cleanup_failed', {
      agentId: id,
      error,
    });
  }

  return c.json({
    ok: true,
    id: agent.id,
    name: agent.name,
    releasedConversationCount: activeConversationIds.length,
    reassignedCount,
  });
});

async function assignedActiveConversationIds(
  db: D1Database,
  agentId: string,
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT id
       FROM conversations
       WHERE assigned_agent = ?1
         AND status IN ('open', 'pending')
         AND expires_at > CURRENT_TIMESTAMP
       ORDER BY last_message_at ASC, id ASC`,
    )
    .bind(agentId)
    .all<{ id: string }>();
  return (result.results ?? []).map((conversation) => conversation.id);
}

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
