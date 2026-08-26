export type AgentAssignment = {
  id: string;
  name: string;
};

export type AgentAssignmentResult = AgentAssignment & {
  newlyAssigned: boolean;
  assignedAt: string | null;
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
 * Attach Worker-internal lifecycle metadata without changing the serialized
 * assignment contract. Existing APIs still emit only { id, name } while the
 * initiating lifecycle can reuse the exact assignment timestamp without another
 * D1 read.
 */
function assignmentResult(
  assignment: AgentAssignment,
  lifecycle: { newlyAssigned: boolean; assignedAt: string | null },
): AgentAssignmentResult {
  const result = { ...assignment } as AgentAssignmentResult;
  Object.defineProperties(result, {
    newlyAssigned: {
      configurable: false,
      enumerable: false,
      value: lifecycle.newlyAssigned,
      writable: false,
    },
    assignedAt: {
      configurable: false,
      enumerable: false,
      value: lifecycle.assignedAt,
      writable: false,
    },
  });
  return result;
}

/**
 * Assign one conversation to one enabled seat with matching routing scope.
 *
 * Automatic traffic delivery is deliberately presence-agnostic: online/busy,
 * heartbeat freshness, active load and daily reception limits do not decide who
 * receives traffic. A fresh billable conversation only requires an enabled,
 * configured seat with available paid traffic quota. Already-receipted traffic
 * can always be requeued without consuming another unit.
 *
 * An active two-hour CTA affinity is preferred when that seat is otherwise
 * eligible. All other traffic follows deterministic round robin through the
 * least-recently-assigned seat. The database assignment statement is atomic, and
 * migration 0042 advances last_assigned_at in the same statement via trigger so
 * concurrent requests observe the latest round-robin cursor.
 */
export async function assignConversationAgent(
  db: D1Database,
  conversationId: string,
  excludedAgentId: string | null = null,
): Promise<AgentAssignmentResult | null> {
  const now = new Date().toISOString();
  const businessDate = routingBusinessDate(new Date(now));
  const assignment = await db
    .prepare(
      `WITH context AS (
         SELECT
           c.site_id,
           c.product_id,
           COALESCE(c.section_id, p.section_id) AS section_id,
           COALESCE(c.category_id, p.category_id) AS category_id,
           c.requeue_excluded_agent_id,
           c.cta_affinity_agent_id,
           c.cta_affinity_expires_at,
           EXISTS (
             SELECT 1
             FROM agent_traffic_receipts receipt
             WHERE receipt.conversation_id = c.id
           ) AS already_received
         FROM conversations c
         LEFT JOIN product_catalog p
           ON p.site_id = c.site_id
          AND p.id = c.product_id
         WHERE c.id = ?1
           AND c.assigned_agent IS NULL
           AND c.expires_at > CURRENT_TIMESTAMP
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
       candidate AS (
         SELECT a.id
         FROM matching m
         JOIN agents a ON a.id = m.agent_id
         JOIN context ctx ON ctx.site_id = a.site_id
         WHERE a.is_enabled = 1
           AND (?4 = '' OR a.id <> ?4)
           AND (
             ctx.requeue_excluded_agent_id IS NULL
             OR a.id <> ctx.requeue_excluded_agent_id
           )
           AND a.username IS NOT NULL
           AND a.password_hash IS NOT NULL
           AND (
             ctx.already_received = 1
             OR a.traffic_quota_enabled = 0
             OR a.traffic_quota_used < a.traffic_quota_total
           )
         ORDER BY
           CASE
             WHEN ctx.cta_affinity_agent_id IS NOT NULL
               AND datetime(ctx.cta_affinity_expires_at) > CURRENT_TIMESTAMP
               AND a.id = ctx.cta_affinity_agent_id
             THEN 0
             ELSE 1
           END ASC,
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
         AND expires_at > CURRENT_TIMESTAMP
         AND EXISTS (SELECT 1 FROM candidate)
       RETURNING assigned_agent AS id,
         (SELECT name FROM agents WHERE id = assigned_agent LIMIT 1) AS name`,
    )
    .bind(conversationId, now, businessDate, excludedAgentId ?? '')
    .first<AgentAssignment>();
  if (!assignment) return assignedAgent(db, conversationId);

  return assignmentResult(assignment, {
    newlyAssigned: true,
    assignedAt: now,
  });
}

async function assignedAgent(
  db: D1Database,
  conversationId: string,
): Promise<AgentAssignmentResult | null> {
  const assignment = await db
    .prepare(
      `SELECT a.id, a.name, c.assigned_at
       FROM conversations c
       JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id
       WHERE c.id = ?1
       LIMIT 1`,
    )
    .bind(conversationId)
    .first<AgentAssignment & { assigned_at: string | null }>();
  if (!assignment) return null;

  return assignmentResult(
    { id: assignment.id, name: assignment.name },
    { newlyAssigned: false, assignedAt: assignment.assigned_at },
  );
}
