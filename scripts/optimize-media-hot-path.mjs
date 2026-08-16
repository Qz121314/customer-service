import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8');
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `Missing replacement target in ${path}`);
  assert.equal(
    source.indexOf(before, first + before.length),
    -1,
    `Replacement target is not unique in ${path}`,
  );
  writeFileSync(path, source.replace(before, after));
}

const mediaStorePath = 'src/worker/media-store.ts';
const mediaApiPath = 'src/worker/media-api.ts';

replaceOnce(
  mediaStorePath,
  `       WHERE (\n         SELECT COUNT(*) FROM media_items\n         WHERE conversation_id = ?2 AND sender_type = ?4 AND status = 'pending'\n       ) < 3\n       AND (\n         SELECT COUNT(*) FROM media_items\n         WHERE conversation_id = ?2 AND sender_type = ?4\n           AND status IN ('pending', 'ready')\n       ) < ?14`,
  `       WHERE (\n         SELECT COUNT(*) < ?14\n           AND COALESCE(\n             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),\n             0\n           ) < 3\n         FROM media_items\n         WHERE conversation_id = ?2 AND sender_type = ?4\n           AND status IN ('pending', 'ready')\n       )`,
);

replaceOnce(
  mediaStorePath,
  `  if (inserted.meta.changes) {\n    const row = await findMedia(db, id);\n    if (!row) throw new Error('Media reservation failed');\n    return { row, reused: false };\n  }`,
  `  if (inserted.meta.changes) {\n    const row: MediaRow = {\n      id,\n      conversation_id: input.conversationId,\n      message_id: null,\n      reserved_message_id: messageId,\n      sender_type: input.senderType,\n      sender_id: input.senderId,\n      object_key: objectKey,\n      mime_type: input.media.mimeType,\n      byte_size: input.media.byteSize,\n      width: input.media.width,\n      height: input.media.height,\n      original_name: input.media.originalName,\n      client_upload_id: input.clientUploadId,\n      status: 'pending',\n      is_initial: 0,\n      reserved_created_at: now,\n    };\n    return { row, reused: false };\n  }`,
);

replaceOnce(
  mediaStorePath,
  `export async function completeMedia(\n  env: MediaBindings,\n  media: MediaRow,\n): Promise<`,
  `export async function completeMedia(\n  env: MediaBindings,\n  media: MediaRow,\n  context: { conversationStatus?: 'open' | 'pending' | 'closed' } = {},\n): Promise<`,
);

replaceOnce(
  mediaStorePath,
  `      { includeOverview: true },`,
  `      {\n        includeOverview:\n          media.sender_type === 'agent' && context.conversationStatus === 'open',\n      },`,
);

replaceOnce(
  mediaApiPath,
  `type ReadyMediaRow = MediaRow & { message_id: string };`,
  `type ReadyMediaRow = MediaRow & { message_id: string };\n\ntype AuthorizedAgentMediaRow = MediaRow & {\n  conversation_status: 'open' | 'pending' | 'closed';\n};`,
);

replaceOnce(
  mediaApiPath,
  `  const site = await findSite(c.env.DB, normalizeProjectId(body?.projectId));\n  if (!site) return clientError(c, 404, 'PROJECT_NOT_FOUND');\n  const conversation = await ownedVisitorConversation(\n    c.env.DB,\n    c.req.param('id'),\n    site.id,\n    visitorId,\n  );\n  if (!conversation) return clientError(c, 404, 'CONVERSATION_NOT_FOUND');`,
  `  const projectId = normalizeProjectId(body?.projectId);\n  const conversation = await ownedVisitorConversation(\n    c.env.DB,\n    c.req.param('id'),\n    projectId,\n    visitorId,\n  );\n  if (!conversation) {\n    const site = await findSite(c.env.DB, projectId);\n    if (!site) return clientError(c, 404, 'PROJECT_NOT_FOUND');\n    return clientError(c, 404, 'CONVERSATION_NOT_FOUND');\n  }`,
);

replaceOnce(
  mediaApiPath,
  `  proxy.searchParams.set('projectId', normalizeProjectId(body?.projectId));`,
  `  proxy.searchParams.set('projectId', projectId);`,
);

replaceOnce(
  mediaApiPath,
  `  const site = await findSite(\n    c.env.DB,\n    normalizeProjectId(c.req.query('projectId')),\n  );\n  if (!site) return clientError(c, 404, 'PROJECT_NOT_FOUND');\n  const conversation = await ownedVisitorConversation(\n    c.env.DB,\n    c.req.param('id'),\n    site.id,\n    visitorId,\n  );\n  if (!conversation) return clientError(c, 404, 'CONVERSATION_NOT_FOUND');`,
  `  const projectId = normalizeProjectId(c.req.query('projectId'));\n  const conversation = await ownedVisitorConversation(\n    c.env.DB,\n    c.req.param('id'),\n    projectId,\n    visitorId,\n  );\n  if (!conversation) {\n    const site = await findSite(c.env.DB, projectId);\n    if (!site) return clientError(c, 404, 'PROJECT_NOT_FOUND');\n    return clientError(c, 404, 'CONVERSATION_NOT_FOUND');\n  }`,
);

replaceOnce(
  mediaApiPath,
  `  const result = await completeMedia(c.env, media.value);\n  if (!result.ok) return c.json({ error: result.code }, result.status);`,
  `  const result = await completeMedia(c.env, media.value, {\n    conversationStatus: media.value.conversation_status,\n  });\n  if (!result.ok) return c.json({ error: result.code }, result.status);`,
);

replaceOnce(
  mediaApiPath,
  `async function authorizedVisitorMedia(\n  c: Context<Env>,\n  readyOnly: boolean,\n  body?: { visitorId?: string; projectId?: string },\n): Promise<\n  { ok: true; value: MediaRow } | { ok: false; status: 400 | 404; code: string }\n> {\n  const visitorId = normalizeVisitorId(\n    body?.visitorId ?? c.req.query('visitorId'),\n  );\n  if (!visitorId) return { ok: false, status: 400, code: 'INVALID_VISITOR_ID' };\n  const site = await findSite(\n    c.env.DB,\n    normalizeProjectId(body?.projectId ?? c.req.query('projectId')),\n  );\n  if (!site) return { ok: false, status: 404, code: 'PROJECT_NOT_FOUND' };\n  const media = await c.env.DB.prepare(\n    \`SELECT mi.id, mi.conversation_id, mi.message_id, mi.reserved_message_id,\n         mi.sender_type, mi.sender_id, mi.object_key, mi.mime_type, mi.byte_size,\n         mi.width, mi.height, mi.original_name, mi.client_upload_id,\n         mi.status, mi.is_initial,\n         mi.reserved_created_at\n       FROM media_items mi\n       JOIN conversations c ON c.id = mi.conversation_id\n       JOIN visitors v ON v.id = c.visitor_id\n       WHERE mi.id = ?1 AND c.site_id = ?2 AND v.external_id = ?3\n         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       LIMIT 1\`,\n  )\n    .bind(c.req.param('id'), site.id, visitorId)\n    .first<MediaRow>();\n  if (!media || (readyOnly && media.status !== 'ready'))\n    return { ok: false, status: 404, code: 'MEDIA_NOT_FOUND' };\n  return { ok: true, value: media };\n}`,
  `async function authorizedVisitorMedia(\n  c: Context<Env>,\n  readyOnly: boolean,\n  body?: { visitorId?: string; projectId?: string },\n): Promise<\n  { ok: true; value: MediaRow } | { ok: false; status: 400 | 404; code: string }\n> {\n  const visitorId = normalizeVisitorId(\n    body?.visitorId ?? c.req.query('visitorId'),\n  );\n  if (!visitorId) return { ok: false, status: 400, code: 'INVALID_VISITOR_ID' };\n  const projectId = normalizeProjectId(\n    body?.projectId ?? c.req.query('projectId'),\n  );\n  const media = await c.env.DB.prepare(\n    \`SELECT mi.id, mi.conversation_id, mi.message_id, mi.reserved_message_id,\n         mi.sender_type, mi.sender_id, mi.object_key, mi.mime_type, mi.byte_size,\n         mi.width, mi.height, mi.original_name, mi.client_upload_id,\n         mi.status, mi.is_initial, mi.reserved_created_at\n       FROM media_items mi\n       JOIN conversations c ON c.id = mi.conversation_id\n       JOIN visitors v ON v.id = c.visitor_id\n       JOIN sites s ON s.id = c.site_id\n       WHERE mi.id = ?1\n         AND (s.id = ?2 OR s.public_key = ?2) AND s.is_enabled = 1\n         AND v.external_id = ?3\n         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       LIMIT 1\`,\n  )\n    .bind(c.req.param('id'), projectId, visitorId)\n    .first<MediaRow>();\n  if (!media) {\n    const site = await findSite(c.env.DB, projectId);\n    if (!site) return { ok: false, status: 404, code: 'PROJECT_NOT_FOUND' };\n    return { ok: false, status: 404, code: 'MEDIA_NOT_FOUND' };\n  }\n  if (readyOnly && media.status !== 'ready')\n    return { ok: false, status: 404, code: 'MEDIA_NOT_FOUND' };\n  return { ok: true, value: media };\n}`,
);

replaceOnce(
  mediaApiPath,
  `async function authorizedAgentMedia(\n  c: Context<Env>,\n  readyOnly: boolean,\n): Promise<\n  { ok: true; value: MediaRow } | { ok: false; status: 401 | 404; code: string }\n> {\n  const agent = await requireAgentSession(c);\n  if (!agent) return { ok: false, status: 401, code: 'UNAUTHORIZED' };\n  const media = await c.env.DB.prepare(\n    \`SELECT mi.id, mi.conversation_id, mi.message_id, mi.reserved_message_id,\n         mi.sender_type, mi.sender_id, mi.object_key, mi.mime_type, mi.byte_size,\n         mi.width, mi.height, mi.original_name, mi.client_upload_id,\n         mi.status, mi.is_initial,\n         mi.reserved_created_at\n       FROM media_items mi\n       JOIN conversations c ON c.id = mi.conversation_id\n       WHERE mi.id = ?1 AND c.assigned_agent = ?2\n         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       LIMIT 1\`,\n  )\n    .bind(c.req.param('id'), agent.id)\n    .first<MediaRow>();\n  if (!media || (readyOnly && media.status !== 'ready'))\n    return { ok: false, status: 404, code: 'NOT_FOUND' };\n  return { ok: true, value: media };\n}`,
  `async function authorizedAgentMedia(\n  c: Context<Env>,\n  readyOnly: boolean,\n): Promise<\n  | { ok: true; value: AuthorizedAgentMediaRow }\n  | { ok: false; status: 401 | 404; code: string }\n> {\n  const agent = await requireAgentSession(c);\n  if (!agent) return { ok: false, status: 401, code: 'UNAUTHORIZED' };\n  const media = await c.env.DB.prepare(\n    \`SELECT mi.id, mi.conversation_id, mi.message_id, mi.reserved_message_id,\n         mi.sender_type, mi.sender_id, mi.object_key, mi.mime_type, mi.byte_size,\n         mi.width, mi.height, mi.original_name, mi.client_upload_id,\n         mi.status, mi.is_initial, mi.reserved_created_at,\n         c.status AS conversation_status\n       FROM media_items mi\n       JOIN conversations c ON c.id = mi.conversation_id\n       WHERE mi.id = ?1 AND c.assigned_agent = ?2\n         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       LIMIT 1\`,\n  )\n    .bind(c.req.param('id'), agent.id)\n    .first<AuthorizedAgentMediaRow>();\n  if (!media || (readyOnly && media.status !== 'ready'))\n    return { ok: false, status: 404, code: 'NOT_FOUND' };\n  return { ok: true, value: media };\n}`,
);

replaceOnce(
  mediaApiPath,
  `async function ownedVisitorConversation(\n  db: D1Database,\n  id: string,\n  siteId: string,\n  visitorId: string,\n) {\n  return db\n    .prepare(\n      \`SELECT c.id, c.visitor_id, c.status\n       FROM conversations c\n       JOIN visitors v ON v.id = c.visitor_id\n       WHERE c.id = ?1 AND c.site_id = ?2 AND v.external_id = ?3\n         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       LIMIT 1\`,\n    )\n    .bind(id, siteId, visitorId)\n    .first<{\n      id: string;\n      visitor_id: string;\n      status: 'open' | 'pending' | 'closed';\n    }>();\n}`,
  `async function ownedVisitorConversation(\n  db: D1Database,\n  id: string,\n  projectId: string,\n  visitorId: string,\n) {\n  return db\n    .prepare(\n      \`SELECT c.id, c.visitor_id, c.status\n       FROM conversations c\n       JOIN visitors v ON v.id = c.visitor_id\n       JOIN sites s ON s.id = c.site_id\n       WHERE c.id = ?1\n         AND (s.id = ?2 OR s.public_key = ?2) AND s.is_enabled = 1\n         AND v.external_id = ?3\n         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       LIMIT 1\`,\n    )\n    .bind(id, projectId, visitorId)\n    .first<{\n      id: string;\n      visitor_id: string;\n      status: 'open' | 'pending' | 'closed';\n    }>();\n}`,
);

const mediaHotPathTest = `import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport test from 'node:test';\n\nconst mediaStore = readFileSync(\n  new URL('../src/worker/media-store.ts', import.meta.url),\n  'utf8',\n);\nconst mediaApi = readFileSync(\n  new URL('../src/worker/media-api.ts', import.meta.url),\n  'utf8',\n);\n\ntest('new media reservations avoid a post-insert read and scan limits once', () => {\n  const reserveStart = mediaStore.indexOf('export async function reserveMedia');\n  const reserveEnd = mediaStore.indexOf('export class MediaUploadIdConflictError');\n  const reserveSource = mediaStore.slice(reserveStart, reserveEnd);\n\n  assert.match(reserveSource, /COALESCE\\(\\s*SUM\\(CASE WHEN status = 'pending'/u);\n  assert.doesNotMatch(reserveSource, /const row = await findMedia\\(db, id\\)/u);\n  assert.equal(\n    (reserveSource.match(/SELECT COUNT\\(\\*\\)/gu) ?? []).length,\n    2,\n    'normal reservation should use one aggregate scan; the second count is conflict-only',\n  );\n});\n\ntest('visitor media ownership folds project validation into the normal D1 read', () => {\n  const siteJoinCount = (mediaApi.match(/JOIN sites s ON s\\.id = c\\.site_id/gu) ?? [])\n    .length;\n  assert.equal(siteJoinCount, 2);\n  assert.match(mediaApi, /AND \\(s\\.id = \\?2 OR s\\.public_key = \\?2\\) AND s\\.is_enabled = 1/u);\n  assert.match(mediaApi, /if \\(!conversation\\) \\{\\s*const site = await findSite/u);\n  assert.match(mediaApi, /if \\(!media\\) \\{\\s*const site = await findSite/u);\n});\n\ntest('media completion keeps R2 verification while skipping stable overview scans', () => {\n  assert.match(mediaStore, /const object = await env\\.MEDIA\\.head\\(media\\.object_key\\)/u);\n  assert.doesNotMatch(mediaStore, /includeOverview: true/u);\n  assert.match(\n    mediaStore,\n    /media\\.sender_type === 'agent' && context\\.conversationStatus === 'open'/u,\n  );\n  assert.match(mediaApi, /c\\.status AS conversation_status/u);\n});\n`;

writeFileSync('test/media-hot-path-cost.test.mjs', mediaHotPathTest);
