import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getVisitorConversation,
  markVisitorConversationRead,
  normalizeVisitorMessage,
  openVisitorConversationSocket,
  sendVisitorMessage,
  sendVisitorGreetingCta,
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
  const [sendingGreetingCta, setSendingGreetingCta] = useState<string | null>(
    null,
  );
  const socketRef = useRef<WebSocket | null>(null);
  const detailRef = useRef<ConversationDetail | null>(null);
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
    let cleanupRealtime: (() => void) | null = null;
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
        detailRef.current = next;
        await markVisitorConversationRead(
          next.conversation.id,
          visitorId,
          token,
          lastReadableMessage(next.messages)?.id ?? null,
        );
        let socket: WebSocket | null = null;
        let timer: number | null = null;
        let retryAttempt = 0;
        let openedOnce = false;
        let loadInFlight: Promise<void> | null = null;
        let stableTimer: number | null = null;
        const loadMissing = () => {
          if (loadInFlight) return loadInFlight;
          const current = detailRef.current;
          const lastMessage = current?.messages.at(-1);
          if (!lastMessage) return Promise.resolve();
          const request = getVisitorConversation(
            next.conversation.id,
            visitorId,
            token,
            {
              after: {
                id: lastMessage.id,
                createdAt: lastMessage.created_at,
              },
            },
          )
            .then((value) => {
              if (!active) return;
              setDetail((currentDetail) => {
                if (!currentDetail) return currentDetail;
                const merged = mergeVisitorMessages(
                  currentDetail.messages,
                  value.messages,
                );
                const updated = { ...currentDetail, messages: merged };
                detailRef.current = updated;
                return updated;
              });
            })
            .catch((reason) => {
              if (active)
                setError(
                  reason instanceof Error ? reason.message : '消息同步失败',
                );
            });
          loadInFlight = request.finally(() => {
            loadInFlight = null;
          });
          return loadInFlight;
        };
        const connect = () => {
          if (!active) return;
          socket = openVisitorConversationSocket(
            next.conversation.id,
            visitorId,
            token,
          );
          socketRef.current = socket;
          socket.addEventListener('open', () => {
            if (!active) return;
            if (openedOnce) void loadMissing();
            openedOnce = true;
            if (stableTimer !== null) window.clearTimeout(stableTimer);
            stableTimer = window.setTimeout(() => {
              retryAttempt = 0;
            }, 10_000);
          });
          socket.addEventListener('message', (event) => {
            try {
              const value = JSON.parse(String(event.data)) as {
                type?: string;
                message?: Message;
              };
              if (value.type === 'message.created' && value.message) {
                setDetail((currentDetail) => {
                  if (!currentDetail) return currentDetail;
                  const updated = {
                    ...currentDetail,
                    messages: mergeVisitorMessages(currentDetail.messages, [
                      normalizeVisitorMessage(value.message!),
                    ]),
                  };
                  detailRef.current = updated;
                  return updated;
                });
              }
            } catch {
              // Ignore heartbeat and malformed frames.
            }
          });
          socket.addEventListener('close', () => {
            if (!active) return;
            socket = null;
            socketRef.current = null;
            if (stableTimer !== null) window.clearTimeout(stableTimer);
            stableTimer = null;
            const delay = Math.min(30_000, 1_000 * 2 ** retryAttempt);
            retryAttempt += 1;
            timer = window.setTimeout(connect, delay);
          });
          socket.addEventListener('error', () => socket?.close());
        };
        const reconnectNow = () => {
          if (!active || socket) return;
          if (timer !== null) window.clearTimeout(timer);
          timer = null;
          retryAttempt = 0;
          connect();
        };
        connect();
        window.addEventListener('online', reconnectNow);
        cleanupRealtime = () => {
          active = false;
          window.removeEventListener('online', reconnectNow);
          socket?.close();
          if (timer !== null) window.clearTimeout(timer);
          if (stableTimer !== null) window.clearTimeout(stableTimer);
        };
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : '无法打开客服会话',
          );
      });
    return () => {
      active = false;
      cleanupRealtime?.();
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
      setDetail((current) => {
        if (!current) return current;
        const updated = {
          ...current,
          messages: mergeVisitorMessages(current.messages, [message]),
        };
        detailRef.current = updated;
        return updated;
      });
    } catch (reason) {
      setBody(messageBody);
      setError(reason instanceof Error ? reason.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  async function submitGreetingCta(ctaId: string) {
    if (!detail || !visitorToken || sending || sendingGreetingCta) return;
    setSendingGreetingCta(ctaId);
    setError('');
    try {
      const messages = await sendVisitorGreetingCta(
        detail.conversation.id,
        visitorId,
        visitorToken,
        ctaId,
        crypto.randomUUID(),
      );
      setDetail((current) => {
        if (!current) return current;
        const updated = {
          ...current,
          messages: mergeVisitorMessages(current.messages, messages),
        };
        detailRef.current = updated;
        return updated;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'CTA 发送失败');
    } finally {
      setSendingGreetingCta(null);
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
              <div key={message.id}>
                <article
                  className={`visitor-message is-${message.sender_type}`}
                >
                  {message.body ||
                    (message.product_context
                      ? message.product_context.title
                      : '')}
                </article>
                {message.sender_type === 'agent' ? (
                  <div className="visitor-greeting-ctas">
                    {detail.greetingCtas
                      ?.filter((cta) => cta.greetingMessageId === message.id)
                      .map((cta) => (
                        <button
                          type="button"
                          key={cta.id}
                          disabled={Boolean(sendingGreetingCta) || sending}
                          onClick={() => void submitGreetingCta(cta.id)}
                        >
                          <span>
                            {sendingGreetingCta === cta.id
                              ? '正在发送…'
                              : cta.label}
                          </span>
                          <span aria-hidden="true">›</span>
                        </button>
                      ))}
                  </div>
                ) : null}
              </div>
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

function mergeVisitorMessages(
  current: Message[],
  incoming: Message[],
): Message[] {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((left, right) => {
    const difference =
      Date.parse(left.created_at) - Date.parse(right.created_at);
    return difference || left.id.localeCompare(right.id);
  });
}

function lastReadableMessage(messages: Message[]): Message | null {
  return (
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.sender_type === 'agent' || message.sender_type === 'system',
      ) ?? null
  );
}
