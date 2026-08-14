from pathlib import Path


def patch(path_name: str, replacements: list[tuple[str, str]]) -> None:
    path = Path(path_name)
    text = path.read_text()
    for old, new in replacements:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f'{path_name}: expected one match, found {count}: {old[:90]!r}')
        text = text.replace(old, new, 1)
    path.write_text(text)


patch(
    'src/worker/client-api.ts',
    [
        (
            """        `UPDATE conversations
       SET last_message_at = ?1, updated_at = ?1
       WHERE id = ?2`,""",
            """        `UPDATE conversations
       SET agent_unread_count = agent_unread_count + 1,
           last_message_at = ?1, updated_at = ?1
       WHERE id = ?2`,""",
        ),
    ],
)

patch(
    'src/worker/media-store.ts',
    [
        (
            """        `UPDATE conversations SET last_message_at = ?1, updated_at = ?1 WHERE id = ?2`,""",
            """        `UPDATE conversations
         SET agent_unread_count = agent_unread_count + 1,
             last_message_at = ?1, updated_at = ?1
         WHERE id = ?2`,""",
        ),
        (
            """             visitor_unread_count = visitor_unread_count + 1,
             last_message_at = ?1, updated_at = ?1""",
            """             visitor_unread_count = visitor_unread_count + 1,
             agent_unread_count = 0,
             last_message_at = ?1, updated_at = ?1""",
        ),
    ],
)

patch(
    'src/worker/agent-api.ts',
    [
        (
            """       c.assigned_agent, c.last_message_at, c.created_at,
       v.display_name AS visitor_name,""",
            """       c.assigned_agent, c.agent_unread_count, c.last_message_at, c.created_at,
       v.display_name AS visitor_name,""",
        ),
        (
            """agentApi.post('/api/agent/conversations/:id/messages', async (c) => {""",
            """agentApi.post('/api/agent/conversations/:id/read', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(
    `UPDATE conversations
     SET agent_unread_count = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1 AND assigned_agent = ?2 AND agent_unread_count > 0`,
  )
    .bind(id, agent.id)
    .run();
  if (result.meta.changes) {
    await broadcastConversationRoom(c.env, 'admin-inbox', {
      type: 'conversation.changed',
      conversationId: id,
    });
  }
  return c.json({ ok: true });
});

agentApi.post('/api/agent/conversations/:id/messages', async (c) => {""",
        ),
        (
            """           visitor_unread_count = visitor_unread_count + 1,
           last_message_at = ?1,""",
            """           visitor_unread_count = visitor_unread_count + 1,
           agent_unread_count = 0,
           last_message_at = ?1,""",
        ),
    ],
)

patch(
    'src/dashboard/api.ts',
    [
        (
            """  assigned_agent: string | null;
  last_message_at: string;""",
            """  assigned_agent: string | null;
  agent_unread_count: number;
  last_message_at: string;""",
        ),
        (
            """export async function sendMessage(id: string, body: string): Promise<Message> {""",
            """export async function markConversationRead(id: string): Promise<void> {
  await request(`/api/agent/conversations/${encodeURIComponent(id)}/read`, {
    method: 'POST',
  });
}

export async function sendMessage(id: string, body: string): Promise<Message> {""",
        ),
    ],
)

patch(
    'src/dashboard/App.tsx',
    [
        (
            """  heartbeat,
  openAgentInboxSocket,""",
            """  heartbeat,
  markConversationRead,
  openAgentInboxSocket,""",
        ),
        (
            """  const messagesRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {""",
            """  const messagesRef = useRef<HTMLDivElement | null>(null);
  const baseTitleRef = useRef(document.title);
  const totalUnread = useMemo(
    () => conversations.reduce((sum, item) => sum + item.agent_unread_count, 0),
    [conversations],
  );

  const acknowledgeConversation = useCallback(async (id: string) => {
    await markConversationRead(id);
    setConversations((current) =>
      current.map((item) =>
        item.id === id ? { ...item, agent_unread_count: 0 } : item,
      ),
    );
  }, []);

  useEffect(() => {
    const baseTitle = baseTitleRef.current;
    document.title = totalUnread > 0 ? `(${totalUnread}) ${baseTitle}` : baseTitle;
    return () => {
      document.title = baseTitle;
    };
  }, [totalUnread]);

  const refresh = useCallback(async () => {""",
        ),
        (
            """      beat();
      void refresh().catch(() => undefined);""",
            """      beat();
      void refresh().catch(() => undefined);
      if (selectedId) void acknowledgeConversation(selectedId).catch(() => undefined);""",
        ),
        (
            """  }, [refresh]);

  useEffect(() => {
    let active = true;""",
            """  }, [acknowledgeConversation, refresh, selectedId]);

  useEffect(() => {
    let active = true;""",
        ),
        (
            """            setDetail(value);
            setMediaItems(media);
          }""",
            """            setDetail(value);
            setMediaItems(media);
            if (document.visibilityState === 'visible') {
              void acknowledgeConversation(selectedId).catch(() => undefined);
            }
          }""",
        ),
        (
            """  }, [selectedId]);

  const lastMessageId""",
            """  }, [acknowledgeConversation, selectedId]);

  const lastMessageId""",
        ),
        (
            """            <h1>我的会话</h1>""",
            """            <h1>
              我的会话
              {totalUnread > 0 && <span className="unread-total">{totalUnread}</span>}
            </h1>""",
        ),
        (
            """                className={
                  conversation.id === selectedId
                    ? 'conversation-row selected'
                    : 'conversation-row'
                }
                onClick={() => setSelectedId(conversation.id)}""",
            """                className={[
                  'conversation-row',
                  conversation.id === selectedId ? 'selected' : '',
                  conversation.agent_unread_count > 0 ? 'unread' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelectedId(conversation.id)}""",
        ),
        (
            """                    <strong>{conversation.visitor_name || '访客'}</strong>
                    <time>{relativeTime(conversation.last_message_at)}</time>""",
            """                    <strong>
                      {conversation.visitor_name || '访客'}
                      {conversation.agent_unread_count > 0 && (
                        <span className="unread-badge">
                          {conversation.status === 'open'
                            ? `新 · ${Math.min(conversation.agent_unread_count, 99)}`
                            : Math.min(conversation.agent_unread_count, 99)}
                        </span>
                      )}
                    </strong>
                    <time>{relativeTime(conversation.last_message_at)}</time>""",
        ),
    ],
)

styles = Path('src/dashboard/styles.css')
styles.write_text(
    styles.read_text()
    + """

.conversation-head h1 {
  display: flex;
  align-items: center;
  gap: 7px;
}

.unread-total {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  display: inline-grid;
  place-items: center;
  background: #1b1d22;
  color: #fff;
  font-size: 10px;
  line-height: 1;
}

.conversation-row.unread {
  background: #fbfbfc;
  box-shadow: inset 3px 0 0 #1b1d22;
}

.conversation-row.unread:hover,
.conversation-row.unread.selected {
  background: #f4f5f7;
}

.conversation-row.unread .conversation-copy > span > strong {
  color: #17191e;
}

.conversation-copy > span > strong {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.unread-badge {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 3px 6px;
  background: #1b1d22;
  color: #fff;
  font-size: 9px;
  font-style: normal;
  line-height: 1;
}
"""
)

Path('test/agent-unread.test.mjs').write_text("""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const migration = await readFile(new URL('migrations/0009_agent_unread.sql', root), 'utf8');
const client = await readFile(new URL('src/worker/client-api.ts', root), 'utf8');
const media = await readFile(new URL('src/worker/media-store.ts', root), 'utf8');
const agent = await readFile(new URL('src/worker/agent-api.ts', root), 'utf8');
const api = await readFile(new URL('src/dashboard/api.ts', root), 'utf8');
const app = await readFile(new URL('src/dashboard/App.tsx', root), 'utf8');

 test('visitor text and image messages persist agent unread counts', () => {
  assert.match(migration, /agent_unread_count INTEGER NOT NULL DEFAULT 0/u);
  assert.match(client, /agent_unread_count = agent_unread_count \+ 1/u);
  assert.match(media, /agent_unread_count = agent_unread_count \+ 1/u);
});

 test('agent inbox exposes and clears persistent unread state', () => {
  assert.match(agent, /c\.agent_unread_count/u);
  assert.match(agent, /conversations\/:id\/read/u);
  assert.match(agent, /SET agent_unread_count = 0/u);
  assert.match(api, /markConversationRead/u);
});

 test('workspace highlights unread conversations and updates the document title', () => {
  assert.match(app, /totalUnread/u);
  assert.match(app, /document\.title/u);
  assert.match(app, /unread-badge/u);
  assert.match(app, /conversation\.agent_unread_count > 0 \? 'unread'/u);
  assert.match(app, /acknowledgeConversation/u);
});
""")
