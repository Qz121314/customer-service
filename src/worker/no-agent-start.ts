import { requestSourceHash } from './abuse-control';
import {
  DEFAULT_NO_AGENT_MESSAGE,
  normalizeNoAgentMessage,
} from './site-settings';

type NoAgentStartEnv = {
  DB: D1Database;
};

type ConversationStartPayload = {
  conversation?: {
    id?: unknown;
    status?: unknown;
  };
};

type UnassignedStartRow = {
  site_id: string;
  visitor_id: string;
  external_id: string;
  start_reuse_key: string | null;
  no_agent_message: string | null;
};

/**
 * Convert a freshly-created unassigned consultation into the public no-agent
 * response. The failed start is removed together with its idempotency receipt and
 * creation counters, so only successfully assigned consultations count toward
 * the 24-hour creation limits.
 */
export async function rejectUnassignedConversationStart(
  request: Request,
  env: NoAgentStartEnv,
  response: Response,
): Promise<Response> {
  if (response.status !== 200 && response.status !== 201) return response;

  const payload = await responsePayload(response);
  const conversationId = normalizeConversationId(payload?.conversation?.id);
  if (!conversationId) return response;

  const row = await env.DB.prepare(
    `SELECT c.site_id, c.visitor_id, v.external_id, c.start_reuse_key,
            s.no_agent_message
     FROM conversations c
     JOIN visitors v ON v.id = c.visitor_id
     JOIN sites s ON s.id = c.site_id
     WHERE c.id = ?1
       AND c.assigned_agent IS NULL
       AND c.status IN ('open', 'pending')
       AND c.expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
  )
    .bind(conversationId)
    .first<UnassignedStartRow>();
  if (!row) return response;

  const reuseKey = row.start_reuse_key?.trim() ?? '';
  if (!reuseKey) {
    console.error('no-agent start is missing its creation reuse key', {
      conversationId,
    });
    return response;
  }

  const sourceHash = await requestSourceHash(request, row.external_id);
  const visitorLimitKey = `visitor:${row.external_id}`;
  const sourceLimitKey = `source:${sourceHash}`;
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM conversations
       WHERE id = ?1
         AND assigned_agent IS NULL
         AND status IN ('open', 'pending')`,
    ).bind(conversationId),
    env.DB.prepare(
      `DELETE FROM conversation_creation_quota_receipts
       WHERE site_id = ?1
         AND reuse_key = ?2
         AND changes() = 1`,
    ).bind(row.site_id, reuseKey),
    env.DB.prepare(
      `UPDATE conversation_creation_limits
       SET accepted_count = MAX(accepted_count - 1, 0),
           updated_at = ?4
       WHERE site_id = ?1
         AND subject_key IN (?2, ?3)`,
    ).bind(row.site_id, visitorLimitKey, sourceLimitKey, now),
    env.DB.prepare(
      `DELETE FROM visitors
       WHERE id = ?1
         AND site_id = ?2
         AND NOT EXISTS (
           SELECT 1
           FROM conversations
           WHERE visitor_id = ?1
         )`,
    ).bind(row.visitor_id, row.site_id),
  ]);

  if (Number(results[0]?.meta?.changes ?? 0) !== 1) return response;
  if (Number(results[1]?.meta?.changes ?? 0) !== 1) {
    console.error('no-agent start did not release its creation quota receipt', {
      conversationId,
      siteId: row.site_id,
    });
  }

  const message =
    normalizeNoAgentMessage(row.no_agent_message) ?? DEFAULT_NO_AGENT_MESSAGE;
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=UTF-8');
  headers.set('Cache-Control', 'no-store');
  headers.delete('Content-Length');
  return new Response(
    JSON.stringify({
      error: {
        code: 'NO_AGENT_AVAILABLE',
        message,
      },
    }),
    { status: 503, headers },
  );
}

async function responsePayload(
  response: Response,
): Promise<ConversationStartPayload | null> {
  try {
    return (await response.clone().json()) as ConversationStartPayload;
  } catch {
    return null;
  }
}

function normalizeConversationId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && id.length <= 200 ? id : null;
}
