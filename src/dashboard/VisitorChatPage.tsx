import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getVisitorConversation,
  markVisitorConversationRead,
  openVisitorConversationSocket,
  sendVisitorMessage,
  startVisitorConversation,
  type ConversationDetail,
  type Message,
} from './api';

const VISITOR_ID_KEY = 'customer-service:visitor-id';
const VISITOR_TOKEN_KEY = 'customer-service:visitor-token';

export function VisitorChatPage() {
  const productId = new URLSearchParams(window.location.search).get(
    'productId',
  );
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [visitorId] = useState(() => getOrCreateVisitorId());
  const [visitorToken, setVisitorToken] = useState(
    () => localStorage.getItem(VISITOR_TOKEN_KEY) ?? '',
  );
  const visitorTokenRef = useRef(visitorToken);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const handoffId = useMemo(
    () =>
      new URLSearchParams(window.location.search).get('sourceHandoffId') ??
      crypto.randomUUID(),
    [],
  );

  useEffect(() => {
    if (!productId) {
      setError('缺少页面产品信息。');
      return;
    }
    let active = true;
    void startVisitorConversation({
      visitorId,
      visitorToken: visitorTokenRef.current || null,
      sourceHandoffId: handoffId,
      productId,
    })
      .then(async (started) => {
        if (!active) return;
        if (started.visitorToken) {
          localStorage.setItem(VISITOR_TOKEN_KEY, started.visitorToken);
          visitorTokenRef.current = started.visitorToken;
          setVisitorToken(started.visitorToken);
        }
        const token = started.visitorToken ?? visitorTokenRef.current;
        if (!token) throw new Error('访客身份令牌未返回，请重试。');
        const next = await getVisitorConversation(
          started.conversation.id,
          visitorId,
          token,
        );
        if (!active) return;
        setDetail(next);
        await markVisitorConversationRead(
          next.conversation.id,
          visitorId,
          token,
          lastAgentMessage(next.messages)?.id ?? null,
        );
        const socket = openVisitorConversationSocket(
          next.conversation.id,
          visitorId,
          token,
        );
        socketRef.current = socket;
        socket.addEventListener('message', (event) => {
          try {
            const value = JSON.parse(String(event.data)) as {
              type?: string;
              message?: Message;
            };
            if (value.type === 'message.created' && value.message) {
              setDetail((current) =>
                current &&
                current.messages.some((m) => m.id === value.message!.id)
                  ? current
                  : current
                    ? {
                        ...current,
                        messages: [...current.messages, value.message!],
                      }
                    : current,
              );
            }
          } catch {
            // Ignore heartbeat and malformed frames.
          }
        });
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : '无法打开客服会话',
          );
      });
    return () => {
      active = false;
      socketRef.current?.close();
    };
  }, [handoffId, productId, visitorId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || !visitorToken || !body.trim() || sending) return;
    setSending(true);
    const messageBody = body.trim();
    setBody('');
    try {
      const message = await sendVisitorMessage(
        detail.conversation.id,
        visitorId,
        visitorToken,
        messageBody,
        crypto.randomUUID(),
      );
      setDetail((current) =>
        current && current.messages.some((item) => item.id === message.id)
          ? current
          : current
            ? { ...current, messages: [...current.messages, message] }
            : current,
      );
    } catch (reason) {
      setBody(messageBody);
      setError(reason instanceof Error ? reason.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="visitor-chat" aria-live="polite">
      <header className="visitor-chat-header">
        <button type="button" onClick={() => window.history.back()}>
          返回
        </button>
        <div>
          <strong>{String(detail?.conversation.agent_name ?? '客服')}</strong>
          <span>
            {String(detail?.conversation.product_title ?? '正在连接…')}
          </span>
        </div>
      </header>
      {error ? <p className="visitor-chat-error">{error}</p> : null}
      {!detail && !error ? (
        <p className="visitor-chat-state">正在连接客服…</p>
      ) : null}
      {detail ? (
        <>
          <section className="visitor-chat-context">
            {String(detail.conversation.product_title ?? '')}
          </section>
          <section className="visitor-chat-messages">
            {detail.messages.map((message) => (
              <article
                className={`visitor-message is-${message.sender_type}`}
                key={message.id}
              >
                {message.body ||
                  (message.product_context
                    ? message.product_context.title
                    : '')}
              </article>
            ))}
          </section>
          <form
            className="visitor-chat-composer"
            onSubmit={(event) => void submit(event)}
          >
            <textarea
              aria-label="发送消息"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="输入消息…"
              rows={1}
            />
            <button type="submit" disabled={sending || !body.trim()}>
              发送
            </button>
          </form>
        </>
      ) : null}
    </main>
  );
}

function getOrCreateVisitorId(): string {
  const existing = localStorage.getItem(VISITOR_ID_KEY);
  if (existing) return existing;
  const value = `visitor-${crypto.randomUUID()}`;
  localStorage.setItem(VISITOR_ID_KEY, value);
  return value;
}

function lastAgentMessage(messages: Message[]): Message | null {
  return (
    [...messages]
      .reverse()
      .find((message) => message.sender_type === 'agent') ?? null
  );
}
