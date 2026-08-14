export type ConversationRoutingContext = {
  sectionId: string;
  categoryId: string | null;
};

type GroupMatchRow = {
  group_id: string;
};

/**
 * Resolve visitor demand context to one support group.
 * Priority is deterministic: exact category -> section -> default group.
 * A legacy group id is accepted only as a migration fallback when no context
 * rule matches, so older Site deployments keep working during rollout.
 */
export async function resolveConversationGroup(
  db: D1Database,
  siteId: string,
  context: ConversationRoutingContext,
  legacyGroupId: string | null,
): Promise<string | null> {
  const categoryId = context.categoryId ?? '';
  const match = await db
    .prepare(
      `SELECT r.group_id
       FROM group_routing_rules r
       JOIN support_groups sg
         ON sg.site_id = r.site_id AND sg.id = r.group_id
       WHERE r.site_id = ?1
         AND r.is_enabled = 1
         AND sg.is_enabled = 1
         AND (
           (?3 <> '' AND r.is_default = 0 AND r.section_id = ?2 AND r.category_id = ?3)
           OR (r.is_default = 0 AND r.section_id = ?2 AND r.category_id = '')
           OR r.is_default = 1
         )
       ORDER BY CASE
         WHEN ?3 <> '' AND r.is_default = 0 AND r.section_id = ?2 AND r.category_id = ?3 THEN 0
         WHEN r.is_default = 0 AND r.section_id = ?2 AND r.category_id = '' THEN 1
         WHEN r.is_default = 1 THEN 2
         ELSE 3
       END ASC,
       r.created_at ASC,
       r.id ASC
       LIMIT 1`,
    )
    .bind(siteId, context.sectionId, categoryId)
    .first<GroupMatchRow>();
  if (match?.group_id) return match.group_id;

  if (!legacyGroupId) return null;
  const legacy = await db
    .prepare(
      `SELECT id
       FROM support_groups
       WHERE site_id = ?1 AND id = ?2 AND is_enabled = 1
       LIMIT 1`,
    )
    .bind(siteId, legacyGroupId)
    .first<{ id: string }>();
  return legacy?.id ?? null;
}
