import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(path, before, after) {
  const source = read(path);
  if (!source.includes(before)) {
    throw new Error(`Expected source not found in ${path}: ${before.slice(0, 100)}`);
  }
  write(path, source.replace(before, after));
}

function replaceAll(path, before, after, minimum = 1) {
  const source = read(path);
  const count = source.split(before).length - 1;
  if (count < minimum) {
    throw new Error(`Expected at least ${minimum} matches in ${path}, found ${count}`);
  }
  write(path, source.split(before).join(after));
}

write(
  'src/worker/conversation-retention.ts',
  `export const CONVERSATION_LIFETIME_HOURS = 24;\nexport const CONVERSATION_LIFETIME_MS =\n  CONVERSATION_LIFETIME_HOURS * 60 * 60 * 1000;\n\ntype RetentionBindings = {\n  DB: D1Database;\n  MEDIA: R2Bucket;\n};\n\ntype ExpiredConversationRow = {\n  id: string;\n};\n\ntype MediaObjectRow = {\n  object_key: string;\n};\n\ntype OrphanVisitorRow = {\n  id: string;\n  site_id: string;\n  external_id: string | null;\n};\n\nconst DELETE_BATCH_SIZE = 100;\nconst MAX_DELETE_PASSES = 10;\n\nexport function conversationExpiresAt(createdAt: string | Date): string {\n  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);\n  const timestamp = created.getTime();\n  if (!Number.isFinite(timestamp)) throw new Error('Invalid conversation creation time');\n  return new Date(timestamp + CONVERSATION_LIFETIME_MS).toISOString();\n}\n\nexport async function purgeExpiredConversations(\n  env: RetentionBindings,\n  now = new Date(),\n): Promise<{ conversations: number; mediaObjects: number; visitors: number }> {\n  const nowIso = now.toISOString();\n  let conversations = 0;\n  let mediaObjects = 0;\n\n  for (let pass = 0; pass < MAX_DELETE_PASSES; pass += 1) {\n    const expired = await env.DB.prepare(\n      \`SELECT id\n       FROM conversations\n       WHERE datetime(COALESCE(expires_at, datetime(created_at, '+1 day'))) <= datetime(?1)\n       ORDER BY COALESCE(expires_at, datetime(created_at, '+1 day')) ASC, id ASC\n       LIMIT ?2\`,\n    )\n      .bind(nowIso, DELETE_BATCH_SIZE)\n      .all<ExpiredConversationRow>();\n    const ids = (expired.results ?? []).map((row) => row.id);\n    if (ids.length === 0) break;\n\n    const placeholders = ids.map((_, index) => \`?\${index + 1}\`).join(', ');\n    const media = await env.DB.prepare(\n      \`SELECT object_key FROM media_items WHERE conversation_id IN (\${placeholders})\`,\n    )\n      .bind(...ids)\n      .all<MediaObjectRow>();\n    const keys = [...new Set((media.results ?? []).map((row) => row.object_key).filter(Boolean))];\n    for (let index = 0; index < keys.length; index += 1000) {\n      const chunk = keys.slice(index, index + 1000);\n      if (chunk.length > 0) await env.MEDIA.delete(chunk);\n    }\n\n    await env.DB.batch([\n      env.DB.prepare(\`DELETE FROM media_items WHERE conversation_id IN (\${placeholders})\`).bind(...ids),\n      env.DB.prepare(\`DELETE FROM messages WHERE conversation_id IN (\${placeholders})\`).bind(...ids),\n      env.DB.prepare(\`DELETE FROM conversations WHERE id IN (\${placeholders})\`).bind(...ids),\n    ]);\n\n    conversations += ids.length;\n    mediaObjects += keys.length;\n  }\n\n  const visitors = await purgeOrphanVisitors(env.DB, nowIso);\n  return { conversations, mediaObjects, visitors };\n}\n\nasync function purgeOrphanVisitors(db: D1Database, nowIso: string): Promise<number> {\n  let removed = 0;\n  for (let pass = 0; pass < MAX_DELETE_PASSES; pass += 1) {\n    const result = await db\n      .prepare(\n        \`SELECT v.id, v.site_id, v.external_id\n         FROM visitors v\n         WHERE datetime(COALESCE(v.expires_at, v.created_at)) <= datetime(?1)\n           AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.visitor_id = v.id)\n         ORDER BY COALESCE(v.expires_at, v.created_at) ASC, v.id ASC\n         LIMIT ?2\`,\n      )\n      .bind(nowIso, DELETE_BATCH_SIZE)\n      .all<OrphanVisitorRow>();\n    const rows = result.results ?? [];\n    if (rows.length === 0) break;\n\n    const statements: D1PreparedStatement[] = [];\n    for (const visitor of rows) {\n      if (visitor.external_id) {\n        statements.push(\n          db\n            .prepare(\n              'DELETE FROM visitor_push_subscriptions WHERE site_id = ?1 AND visitor_external_id = ?2',\n            )\n            .bind(visitor.site_id, visitor.external_id),\n        );\n      }\n      statements.push(db.prepare('DELETE FROM visitors WHERE id = ?1').bind(visitor.id));\n    }\n    if (statements.length > 0) await db.batch(statements);\n    removed += rows.length;\n  }\n  return removed;\n}\n`,
);

write(
  'migrations/0012_conversation_retention.sql',
  `PRAGMA foreign_keys = ON;\n\nCREATE INDEX IF NOT EXISTS idx_conversations_expiry\n  ON conversations(expires_at);\n\n-- A visitor identity may own several conversations created at different times.\n-- Keep the identity alive at least as long as its latest conversation so the\n-- conversation's own 24-hour expiry is the only user-visible lifetime boundary.\nUPDATE visitors\nSET expires_at = (\n  SELECT MAX(COALESCE(c.expires_at, datetime(c.created_at, '+1 day')))\n  FROM conversations c\n  WHERE c.visitor_id = visitors.id\n)\nWHERE EXISTS (\n  SELECT 1 FROM conversations c WHERE c.visitor_id = visitors.id\n)\nAND (\n  expires_at IS NULL\n  OR datetime(expires_at) < datetime((\n    SELECT MAX(COALESCE(c.expires_at, datetime(c.created_at, '+1 day')))\n    FROM conversations c\n    WHERE c.visitor_id = visitors.id\n  ))\n);\n`,
);

write(
  'test/conversation-retention.test.mjs',
  `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport {\n  CONVERSATION_LIFETIME_HOURS,\n  conversationExpiresAt,\n} from '../src/worker/conversation-retention.ts';\n\ntest('conversation expiry is fixed at 24 hours after creation', () => {\n  assert.equal(CONVERSATION_LIFETIME_HOURS, 24);\n  assert.equal(\n    conversationExpiresAt('2026-08-14T10:00:00.000Z'),\n    '2026-08-15T10:00:00.000Z',\n  );\n});\n`,
);

replaceOnce(
  'wrangler.jsonc',
  `  "keep_vars": true,\n`,
  `  "keep_vars": true,\n  "triggers": {\n    "crons": ["* * * * *"],\n  },\n`,
);

replaceOnce(
  'src/worker/entry.ts',
  `import { sendVisitorPushForConversation } from './visitor-push';\n`,
  `import { sendVisitorPushForConversation } from './visitor-push';\nimport { purgeExpiredConversations } from './conversation-retention';\n`,
);
replaceOnce(
  'src/worker/entry.ts',
  `export default app;\nexport { ConversationRoom };\n`,
  `export default {\n  fetch: app.fetch,\n  scheduled(\n    _controller: ScheduledController,\n    env: Bindings,\n    ctx: ExecutionContext,\n  ) {\n    ctx.waitUntil(\n      purgeExpiredConversations(env).catch((error) => {\n        console.error('Expired conversation cleanup failed.', error);\n      }),\n    );\n  },\n};\nexport { ConversationRoom };\n`,
);

replaceOnce(
  'src/worker/client-api.ts',
  `import { cors } from 'hono/cors';\n`,
  `import { cors } from 'hono/cors';\nimport { conversationExpiresAt } from './conversation-retention';\n`,
);
replaceAll(
  'src/worker/client-api.ts',
  `       AND COALESCE(v.expires_at, datetime(v.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n`,
  `       AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n`,
  2,
);
replaceOnce(
  'src/worker/client-api.ts',
  `  if (existing && isFuture(existing.expires_at)) {\n    await db\n      .prepare(\n        'UPDATE visitors SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1',\n      )\n      .bind(existing.id)\n      .run();\n    return existing;\n  }\n\n  if (existing) {\n    await db\n      .prepare('DELETE FROM visitors WHERE id = ?1')\n      .bind(existing.id)\n      .run();\n  }\n`,
  `  if (existing) {\n    const expiresAt = conversationExpiresAt(new Date());\n    await db\n      .prepare(\n        \`UPDATE visitors\n         SET last_seen_at = CURRENT_TIMESTAMP, expires_at = ?2\n         WHERE id = ?1\`,\n      )\n      .bind(existing.id, expiresAt)\n      .run();\n    return { ...existing, expires_at: expiresAt };\n  }\n`,
);
replaceAll(
  'src/worker/client-api.ts',
  `  const expiresAt = new Date(\n    Date.now() + VISITOR_LIFETIME_HOURS * 60 * 60 * 1000,\n  ).toISOString();\n`,
  `  const expiresAt = conversationExpiresAt(new Date());\n`,
  1,
);
replaceOnce(
  'src/worker/client-api.ts',
  `  const expiresAt = new Date(\n    Date.now() + VISITOR_LIFETIME_HOURS * 60 * 60 * 1000,\n  ).toISOString();\n\n  await c.env.DB.prepare(`,
  `  const expiresAt = conversationExpiresAt(now);\n\n  await c.env.DB.prepare(`,
);

replaceOnce(
  'src/worker/agent-api.ts',
  `     FROM conversations\n     WHERE assigned_agent = ?1\n     GROUP BY status`,
  `     FROM conversations\n     WHERE assigned_agent = ?1\n       AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP\n     GROUP BY status`,
);
replaceOnce(
  'src/worker/agent-api.ts',
  `       c.assigned_agent, c.agent_unread_count, c.last_message_at, c.created_at,\n`,
  `       c.assigned_agent, c.agent_unread_count, c.last_message_at, c.created_at,\n       c.expires_at,\n`,
);
replaceOnce(
  'src/worker/agent-api.ts',
  `     WHERE c.assigned_agent = ?1\n       \${filtered ? 'AND c.status = ?2' : ''}\n`,
  `     WHERE c.assigned_agent = ?1\n       AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       \${filtered ? 'AND c.status = ?2' : ''}\n`,
);
replaceOnce(
  'src/worker/agent-api.ts',
  `     WHERE id = ?2 AND assigned_agent = ?3`,
  `     WHERE id = ?2 AND assigned_agent = ?3\n       AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP`,
);
replaceOnce(
  'src/worker/agent-api.ts',
  `       WHERE c.id = ?1 AND c.assigned_agent = ?2\n       LIMIT 1`,
  `       WHERE c.id = ?1 AND c.assigned_agent = ?2\n         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       LIMIT 1`,
);
replaceOnce(
  'src/worker/agent-api.ts',
  `     WHERE c.assigned_agent IS NULL\n       AND c.status IN ('open', 'pending')\n`,
  `     WHERE c.assigned_agent IS NULL\n       AND c.status IN ('open', 'pending')\n       AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n`,
);

replaceOnce(
  'src/worker/routing.ts',
  `       WHERE id = ?1\n       LIMIT 1`,
  `       WHERE id = ?1\n         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP\n       LIMIT 1`,
);
replaceOnce(
  'src/worker/routing.ts',
  `         WHERE status IN ('open', 'pending')\n           AND assigned_agent IS NOT NULL\n`,
  `         WHERE status IN ('open', 'pending')\n           AND assigned_agent IS NOT NULL\n           AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP\n`,
);
replaceOnce(
  'src/worker/routing.ts',
  `         WHERE id = ?3 AND assigned_agent IS NULL`,
  `         WHERE id = ?3 AND assigned_agent IS NULL\n           AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP`,
);

replaceAll(
  'src/worker/media-api.ts',
  `         AND COALESCE(v.expires_at, datetime(v.created_at, '+1 day')) > CURRENT_TIMESTAMP\n         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n`,
  `         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n`,
);
replaceOnce(
  'src/worker/media-api.ts',
  `       WHERE mi.id = ?1 AND c.site_id = ?2 AND v.external_id = ?3\n       LIMIT 1`,
  `       WHERE mi.id = ?1 AND c.site_id = ?2 AND v.external_id = ?3\n         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       LIMIT 1`,
);
replaceOnce(
  'src/worker/media-api.ts',
  `       WHERE mi.id = ?1 AND c.assigned_agent = ?2\n       LIMIT 1`,
  `       WHERE mi.id = ?1 AND c.assigned_agent = ?2\n         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       LIMIT 1`,
);
replaceOnce(
  'src/worker/media-api.ts',
  `      'SELECT id, status FROM conversations WHERE id = ?1 AND assigned_agent = ?2',\n`,
  `      \`SELECT id, status FROM conversations\n       WHERE id = ?1 AND assigned_agent = ?2\n         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP\`,\n`,
);

replaceOnce(
  'src/dashboard/api.ts',
  `  created_at: string;\n  visitor_name: string | null;\n`,
  `  created_at: string;\n  expires_at: string | null;\n  visitor_name: string | null;\n`,
);

replaceOnce(
  'src/dashboard/App.tsx',
  `  const [mediaProgress, setMediaProgress] = useState<number | null>(null);\n  const [draft, setDraft] = useState('');\n`,
  `  const [mediaProgress, setMediaProgress] = useState<number | null>(null);\n  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);\n  const [mediaPendingFile, setMediaPendingFile] = useState<File | null>(null);\n  const [mediaFailed, setMediaFailed] = useState(false);\n  const [draft, setDraft] = useState('');\n`,
);
replaceOnce(
  'src/dashboard/App.tsx',
  `  const lastMessageId = detail?.messages.at(-1)?.id ?? null;\n`,
  `  const lastMessageId = detail?.messages.at(-1)?.id ?? null;\n  const selectedExpiresAt = detail?.conversation.expires_at ?? null;\n\n  useEffect(() => {\n    if (!selectedId || !selectedExpiresAt) return;\n    const expiresAt = Date.parse(selectedExpiresAt);\n    if (!Number.isFinite(expiresAt)) return;\n    const expire = () => {\n      setSelectedId(null);\n      setDetail(null);\n      setMediaItems([]);\n      void refresh().catch(() => undefined);\n    };\n    const remaining = expiresAt - Date.now();\n    if (remaining <= 0) {\n      expire();\n      return;\n    }\n    const timer = window.setTimeout(expire, remaining + 100);\n    return () => window.clearTimeout(timer);\n  }, [refresh, selectedExpiresAt, selectedId]);\n`,
);
replaceOnce(
  'src/dashboard/App.tsx',
  `  async function submitImage(file: File) {\n    if (!selectedId) return;\n    setMediaProgress(0);\n    try {\n      await sendAgentImage(selectedId, file, setMediaProgress);\n      const [nextDetail, nextMedia] = await Promise.all([\n        getConversation(selectedId),\n        getAgentMedia(selectedId),\n      ]);\n      setDetail(nextDetail);\n      setMediaItems(nextMedia);\n    } catch (reason) {\n      setError(message(reason, '图片发送失败'));\n    } finally {\n      setMediaProgress(null);\n    }\n  }\n`,
  `  async function uploadImage(file: File, previewUrl: string) {\n    if (!selectedId) return;\n    setMediaProgress(0);\n    setMediaFailed(false);\n    try {\n      await sendAgentImage(selectedId, file, setMediaProgress);\n      const [nextDetail, nextMedia] = await Promise.all([\n        getConversation(selectedId),\n        getAgentMedia(selectedId),\n      ]);\n      setDetail(nextDetail);\n      setMediaItems(nextMedia);\n      setMediaPendingFile(null);\n      setMediaPreviewUrl(null);\n      URL.revokeObjectURL(previewUrl);\n    } catch (reason) {\n      setMediaFailed(true);\n      setError(message(reason, '图片发送失败'));\n    } finally {\n      setMediaProgress(null);\n    }\n  }\n\n  async function submitImage(file: File) {\n    if (!selectedId) return;\n    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);\n    const previewUrl = URL.createObjectURL(file);\n    setMediaPreviewUrl(previewUrl);\n    setMediaPendingFile(file);\n    await uploadImage(file, previewUrl);\n  }\n\n  async function retryImage() {\n    if (!mediaPendingFile || !mediaPreviewUrl || mediaProgress !== null) return;\n    await uploadImage(mediaPendingFile, mediaPreviewUrl);\n  }\n`,
);
replaceOnce(
  'src/dashboard/App.tsx',
  `                <p>\n                  {String(\n                    detail.conversation.product_title ||\n                      detail.conversation.subject ||\n                      '访客咨询',\n                  )}\n                </p>\n`,
  `                <p>\n                  {String(\n                    detail.conversation.product_title ||\n                      detail.conversation.subject ||\n                      '访客咨询',\n                  )}\n                </p>\n                <ConversationExpiryCountdown\n                  expiresAt={detail.conversation.expires_at}\n                />\n`,
);
replaceOnce(
  'src/dashboard/App.tsx',
  `              {(detail.messages as Message[]).map((item) => (\n                <Bubble\n                  key={item.id}\n                  message={item}\n                  media={\n                    mediaItems.find((media) => media.messageId === item.id) ??\n                    null\n                  }\n                />\n              ))}\n`,
  `              {(detail.messages as Message[]).map((item) => (\n                <Bubble\n                  key={item.id}\n                  message={item}\n                  media={\n                    mediaItems.find((media) => media.messageId === item.id) ??\n                    null\n                  }\n                />\n              ))}\n              {mediaPreviewUrl ? (\n                <div className="message mine is-uploading">\n                  <div>\n                    <div className="message-image-pending">\n                      <img\n                        className="message-image"\n                        src={mediaPreviewUrl}\n                        alt="待发送图片"\n                      />\n                      <button\n                        type="button"\n                        className={\`media-inline-status\${mediaFailed ? ' is-failed' : ''}\`}\n                        disabled={!mediaFailed || !mediaPendingFile}\n                        aria-label={mediaFailed ? '重试发送图片' : '图片发送中'}\n                        onClick={() => void retryImage()}\n                      >\n                        {mediaFailed ? (\n                          '!'\n                        ) : (\n                          <span\n                            className="media-inline-ring"\n                            style={{\n                              '--media-upload-progress': \`${Math.round((mediaProgress ?? 0) * 360)}deg\`,\n                            } as React.CSSProperties}\n                          >\n                            {Math.round((mediaProgress ?? 0) * 100)}\n                          </span>\n                        )}\n                      </button>\n                    </div>\n                    <span className="message-meta">\n                      <span>{mediaFailed ? '发送失败 · 点击重试' : '发送中'}</span>\n                    </span>\n                  </div>\n                </div>\n              ) : null}\n`,
);
replaceOnce(
  'src/dashboard/App.tsx',
  `                  {mediaProgress === null\n                    ? 'Enter 发送 · Shift + Enter 换行'\n                    : \`图片上传 \${Math.round(mediaProgress * 100)}%\`}\n`,
  `                  Enter 发送 · Shift + Enter 换行\n`,
);
replaceOnce(
  'src/dashboard/App.tsx',
  `function Bubble({\n`,
  `function ConversationExpiryCountdown({\n  expiresAt,\n}: {\n  expiresAt: string | null;\n}) {\n  const [now, setNow] = useState(() => Date.now());\n\n  useEffect(() => {\n    const timer = window.setInterval(() => setNow(Date.now()), 1000);\n    return () => window.clearInterval(timer);\n  }, [expiresAt]);\n\n  const timestamp = expiresAt ? Date.parse(expiresAt) : Number.NaN;\n  if (!Number.isFinite(timestamp)) return null;\n  const remaining = Math.max(0, timestamp - now);\n  const totalSeconds = Math.ceil(remaining / 1000);\n  const hours = Math.floor(totalSeconds / 3600);\n  const minutes = Math.floor((totalSeconds % 3600) / 60);\n  const seconds = totalSeconds % 60;\n  const clock = [hours, minutes, seconds]\n    .map((value) => String(value).padStart(2, '0'))\n    .join(':');\n  const urgency =\n    remaining <= 5 * 60 * 1000\n      ? ' is-urgent'\n      : remaining <= 60 * 60 * 1000\n        ? ' is-warning'\n        : '';\n\n  return (\n    <span className={\`conversation-expiry\${urgency}\`} aria-live="off">\n      <span aria-hidden="true">◷</span>\n      {remaining > 0 ? \`会话将在 \${clock} 后自动删除\` : '会话已到期，正在删除'}\n    </span>\n  );\n}\n\nfunction Bubble({\n`,
);

fs.appendFileSync(
  'src/dashboard/styles.css',
  `\n\n/* Ephemeral 24-hour conversation state */\n.conversation-expiry {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  margin-top: 8px;\n  padding: 6px 9px;\n  border-radius: 999px;\n  background: color-mix(in srgb, var(--surface, #fff) 86%, #f2b84b 14%);\n  font-size: 12px;\n  font-weight: 700;\n  color: var(--muted, #6a6257);\n}\n\n.conversation-expiry.is-warning {\n  color: #8a5a00;\n}\n\n.conversation-expiry.is-urgent {\n  color: #a62c2c;\n}\n\n.message.is-uploading > div {\n  opacity: 0.96;\n}\n\n.message-image-pending {\n  position: relative;\n  overflow: hidden;\n  border-radius: 12px;\n}\n\n.media-inline-status {\n  position: absolute;\n  inset: 0;\n  margin: auto;\n  width: 52px;\n  height: 52px;\n  border: 0;\n  border-radius: 50%;\n  display: grid;\n  place-items: center;\n  background: rgb(0 0 0 / 48%);\n  color: #fff;\n  font-weight: 800;\n}\n\n.media-inline-status:disabled {\n  opacity: 1;\n}\n\n.media-inline-status.is-failed {\n  cursor: pointer;\n  font-size: 24px;\n}\n\n.media-inline-ring {\n  --media-upload-progress: 0deg;\n  width: 38px;\n  height: 38px;\n  border-radius: 50%;\n  display: grid;\n  place-items: center;\n  background: conic-gradient(#fff var(--media-upload-progress), rgb(255 255 255 / 28%) 0);\n  font-size: 11px;\n}\n\n.media-inline-ring::before {\n  content: '';\n  position: absolute;\n  width: 30px;\n  height: 30px;\n  border-radius: 50%;\n  background: rgb(0 0 0 / 58%);\n}\n\n.media-inline-ring {\n  position: relative;\n}\n\n.media-inline-ring > * {\n  position: relative;\n}\n`,
);
