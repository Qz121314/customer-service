export const DEFAULT_NO_AGENT_MESSAGE = '当前暂无可接待客服，请稍后再试。';

const MAX_NO_AGENT_MESSAGE_LENGTH = 300;

export function normalizeNoAgentMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const message = value.trim();
  if (!message || message.length > MAX_NO_AGENT_MESSAGE_LENGTH) return null;
  return message;
}

export async function loadNoAgentMessage(
  db: D1Database,
  siteId = 'default',
): Promise<string> {
  const row = await db
    .prepare(
      `SELECT no_agent_message
       FROM sites
       WHERE id = ?1
       LIMIT 1`,
    )
    .bind(siteId)
    .first<{ no_agent_message: string | null }>();
  return (
    normalizeNoAgentMessage(row?.no_agent_message) ?? DEFAULT_NO_AGENT_MESSAGE
  );
}
