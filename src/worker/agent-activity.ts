export async function touchAgentActivity(
  db: D1Database,
  agentId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE agents
       SET last_seen_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1
         AND (
           last_seen_at IS NULL
           OR datetime(last_seen_at) <= datetime('now', '-90 seconds')
         )`,
    )
    .bind(agentId)
    .run();
}
