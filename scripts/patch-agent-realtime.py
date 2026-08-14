from pathlib import Path

path = Path('src/dashboard/App.tsx')
text = path.read_text()


def replace_once(old: str, new: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one match, found {count}: {old[:80]!r}')
    text = text.replace(old, new, 1)


replace_once(
    "import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';",
    "import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';",
)

replace_once(
    "  const [mediaProgress, setMediaProgress] = useState<number | null>(null);\n  const [draft, setDraft] = useState('');\n  const [busy, setBusy] = useState(true);\n  const [error, setError] = useState('');",
    "  const [mediaProgress, setMediaProgress] = useState<number | null>(null);\n  const [draft, setDraft] = useState('');\n  const [sending, setSending] = useState(false);\n  const [inboxConnected, setInboxConnected] = useState(false);\n  const [threadConnected, setThreadConnected] = useState(false);\n  const [busy, setBusy] = useState(true);\n  const [error, setError] = useState('');\n  const messagesRef = useRef<HTMLDivElement | null>(null);",
)

replace_once(
    """  useEffect(() => {
    void heartbeat()
      .then(refresh)
      .catch(() => undefined);
    const timer = window.setInterval(() => {
      void heartbeat()
        .then(refresh)
        .catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);""",
    """  useEffect(() => {
    const beat = () => void heartbeat().catch(() => undefined);
    const recover = () => {
      if (document.visibilityState !== 'visible') return;
      beat();
      void refresh().catch(() => undefined);
    };

    beat();
    const timer = window.setInterval(beat, 30_000);
    document.addEventListener('visibilitychange', recover);
    window.addEventListener('online', recover);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('online', recover);
    };
  }, [refresh]);""",
)

replace_once(
    """  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    const connect = () => {
      if (!active) return;
      socket = openAgentInboxSocket();
      socket.addEventListener('message', () => {
        if (active) void refresh();
      });
      socket.addEventListener('close', () => {
        if (active) timer = window.setTimeout(connect, 1200);
      });
      socket.addEventListener('error', () => socket?.close());
    };
    connect();
    return () => {
      active = false;
      socket?.close();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refresh]);""",
    """  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    let openedOnce = false;
    const connect = () => {
      if (!active) return;
      socket = openAgentInboxSocket();
      socket.addEventListener('open', () => {
        if (!active) return;
        setInboxConnected(true);
        if (openedOnce) void refresh().catch(() => undefined);
        openedOnce = true;
      });
      socket.addEventListener('message', () => {
        if (active) void refresh().catch(() => undefined);
      });
      socket.addEventListener('close', () => {
        if (!active) return;
        setInboxConnected(false);
        timer = window.setTimeout(connect, 1200);
      });
      socket.addEventListener('error', () => socket?.close());
    };
    connect();
    return () => {
      active = false;
      setInboxConnected(false);
      socket?.close();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refresh]);""",
)

replace_once(
    """  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setMediaItems([]);
      return;
    }
    let active = true;
    const load = () =>
      Promise.all([getConversation(selectedId), getAgentMedia(selectedId)])
        .then(([value, media]) => {
          if (active) {
            setDetail(value);
            setMediaItems(media);
          }
        })
        .catch((reason) => {
          if (active) setError(message(reason, '无法加载会话'));
        });
    void load();
    const socket = openConversationSocket(selectedId);
    socket.addEventListener('message', () => {
      if (active) {
        void load();
        void refresh();
      }
    });
    socket.addEventListener('error', () => socket.close());
    return () => {
      active = false;
      socket.close();
    };
  }, [refresh, selectedId]);""",
    """  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setMediaItems([]);
      setThreadConnected(false);
      return;
    }
    let active = true;
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    let openedOnce = false;
    const load = () =>
      Promise.all([getConversation(selectedId), getAgentMedia(selectedId)])
        .then(([value, media]) => {
          if (active) {
            setDetail(value);
            setMediaItems(media);
          }
        })
        .catch((reason) => {
          if (active) setError(message(reason, '无法加载会话'));
        });
    const connect = () => {
      if (!active) return;
      socket = openConversationSocket(selectedId);
      socket.addEventListener('open', () => {
        if (!active) return;
        setThreadConnected(true);
        if (openedOnce) void load();
        openedOnce = true;
      });
      socket.addEventListener('message', () => {
        if (active) void load();
      });
      socket.addEventListener('close', () => {
        if (!active) return;
        setThreadConnected(false);
        timer = window.setTimeout(connect, 1200);
      });
      socket.addEventListener('error', () => socket?.close());
    };
    void load();
    connect();
    return () => {
      active = false;
      setThreadConnected(false);
      socket?.close();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [selectedId]);

  const lastMessageId = detail?.messages.at(-1)?.id ?? null;
  useEffect(() => {
    const timeline = messagesRef.current;
    if (!timeline) return;
    const frame = window.requestAnimationFrame(() => {
      timeline.scrollTo({ top: timeline.scrollHeight, behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [lastMessageId, selectedId]);""",
)

replace_once(
    """  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    try {
      await sendMessage(selectedId, text);
      setDetail(await getConversation(selectedId));
      await refresh();
    } catch (reason) {
      setDraft(text);
      setError(message(reason, '发送失败'));
    }
  }""",
    """  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !draft.trim() || sending) return;
    const text = draft.trim();
    setSending(true);
    setDraft('');
    try {
      await sendMessage(selectedId, text);
      setDetail(await getConversation(selectedId));
    } catch (reason) {
      setDraft((current) => current || text);
      setError(message(reason, '发送失败'));
    } finally {
      setSending(false);
    }
  }""",
)

replace_once(
    "      setDetail(nextDetail);\n      setMediaItems(nextMedia);\n      await refresh();",
    "      setDetail(nextDetail);\n      setMediaItems(nextMedia);",
)
replace_once(
    '          <span className="online-pill">在线接待</span>',
    """          <span className="online-pill" aria-live="polite">
            {inboxConnected && (!selectedId || threadConnected)
              ? '实时在线'
              : '正在重连'}
          </span>""",
)
replace_once(
    '            <div className="messages">',
    '            <div className="messages" ref={messagesRef}>',
)
replace_once(
    """                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }""",
    """                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }""",
)
replace_once(
    "                    !draft.trim() || detail.conversation.status === 'closed'",
    "                    sending ||\n                    !draft.trim() ||\n                    detail.conversation.status === 'closed'",
)

path.write_text(text)

Path('test/agent-realtime-hardening.test.mjs').write_text("""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/dashboard/App.tsx', import.meta.url), 'utf8');

test('heartbeat only maintains presence instead of polling every 30 seconds', () => {
  assert.match(source, /setInterval\\(beat, 30_000\\)/u);
  assert.doesNotMatch(source, /heartbeat\\(\\)[\\s\\S]{0,80}\\.then\\(refresh\\)/u);
});

test('agent sockets reconnect and recover after disconnects', () => {
  assert.match(source, /setInboxConnected\\(false\\)[\\s\\S]{0,140}setTimeout\\(connect, 1200\\)/u);
  assert.match(source, /setThreadConnected\\(false\\)[\\s\\S]{0,140}setTimeout\\(connect, 1200\\)/u);
  assert.match(source, /visibilitychange/u);
  assert.match(source, /addEventListener\\('online', recover\\)/u);
});

test('thread guards sends and follows new messages', () => {
  assert.match(source, /const \\[sending, setSending\\] = useState\\(false\\)/u);
  assert.match(source, /nativeEvent\\.isComposing/u);
  assert.match(source, /messagesRef/u);
  assert.match(source, /timeline\\.scrollTo/u);
  assert.match(source, /setDraft\\(\\(current\\) => current \\|\\| text\\)/u);
});
""")
