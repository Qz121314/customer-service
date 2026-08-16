import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/worker/agent-api.ts';
let source = readFileSync(path, 'utf8');

const loadTransferTargets = [
  'async function loadTransferTargets(db: D1Database, agentId: string) {',
  '  const businessDate = routingBusinessDate();',
  '  const result = await db',
  '    .prepare(',
  '      `SELECT a.id, a.name, a.status, a.max_active_conversations,',
  '         COUNT(load.id) AS active_count',
  '       FROM agents current',
  '       JOIN agents a ON a.site_id = current.site_id AND a.id <> current.id',
  '       LEFT JOIN conversations load',
  '         ON load.assigned_agent = a.id',
  "        AND load.status IN ('open', 'pending')",
  "        AND COALESCE(load.expires_at, datetime(load.created_at, '+1 day')) > CURRENT_TIMESTAMP",
  '       LEFT JOIN agent_daily_stats daily',
  '         ON daily.site_id = a.site_id',
  '        AND daily.agent_id = a.id',
  '        AND daily.business_date = ?2',
  '       WHERE current.id = ?1',
  '         AND a.is_enabled = 1',
  "         AND a.status = 'online'",
  '         AND a.username IS NOT NULL',
  '         AND a.password_hash IS NOT NULL',
  '         AND a.last_seen_at IS NOT NULL',
  "         AND datetime(a.last_seen_at) >= datetime('now', '-2 minutes')",
  '         AND (',
  '           a.daily_conversation_limit = 0',
  '           OR COALESCE(daily.conversation_count, 0) < a.daily_conversation_limit',
  '         )',
  '         AND (',
  '           a.traffic_quota_enabled = 0',
  '           OR a.traffic_quota_used < a.traffic_quota_total',
  '         )',
  '       GROUP BY a.id, a.name, a.status, a.max_active_conversations',
  '       HAVING (',
  '         a.max_active_conversations = 0',
  '         OR COUNT(load.id) < a.max_active_conversations',
  '       )',
  '       ORDER BY COUNT(load.id) ASC, a.name ASC, a.id ASC`,',
  '    )',
  '    .bind(agentId, businessDate)',
  '    .all<TransferTargetRow>();',
  '  return result.results ?? [];',
  '}',
  '',
].join('\n');

const loadPattern = /async function loadTransferTargets\(db: D1Database, agentId: string\) \{[\s\S]*?\n\}\n\n(?=async function loadQuickReplies)/u;
if (!loadPattern.test(source)) {
  throw new Error('loadTransferTargets function was not found exactly once.');
}
source = source.replace(loadPattern, `${loadTransferTargets}\n`);

const globalTransferLoadPattern = /\n           LEFT JOIN \(\n             SELECT assigned_agent, COUNT\(\*\) AS active_count\n             FROM conversations\n             WHERE status IN \('open', 'pending'\)\n               AND assigned_agent IS NOT NULL\n               AND COALESCE\(expires_at, datetime\(created_at, '\+1 day'\)\) > CURRENT_TIMESTAMP\n             GROUP BY assigned_agent\n           \) load ON load\.assigned_agent = target\.id/u;
const globalMatches = source.match(globalTransferLoadPattern) ?? [];
if (globalMatches.length !== 1) {
  throw new Error(`Expected one direct-transfer global load block, found ${globalMatches.length}.`);
}
source = source.replace(globalTransferLoadPattern, '');

const capacityBefore = [
  '             AND (',
  '               target.max_active_conversations = 0',
  '               OR COALESCE(load.active_count, 0) < target.max_active_conversations',
  '             )',
].join('\n');
const capacityAfter = [
  '             AND (',
  '               target.max_active_conversations = 0',
  '               OR (',
  '                 SELECT COUNT(*)',
  '                 FROM conversations load',
  '                 WHERE load.assigned_agent = target.id',
  "                   AND load.status IN ('open', 'pending')",
  "                   AND COALESCE(load.expires_at, datetime(load.created_at, '+1 day')) > CURRENT_TIMESTAMP",
  '               ) < target.max_active_conversations',
  '             )',
].join('\n');
if (!source.includes(capacityBefore)) {
  throw new Error('Direct-transfer capacity predicate was not found.');
}
source = source.replace(capacityBefore, capacityAfter);

writeFileSync(path, source);
