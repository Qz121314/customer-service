import {
  type CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AgentAvailability,
  AgentInbox,
  AgentIdentity,
  Conversation,
  ConversationDetail,
  Message,
  QuickReply,
  TransferTarget,
  agentLogin,
  agentLogout,
  createQuickReply,
  deleteQuickReply,
  getAgentInbox,
  getAgentSession,
  getConversation,
  heartbeat,
  markConversationRead,
  openAgentInboxSocket,
  openConversationSocket,
  realtimeReconnectDelay,
  sendMessage,
  setAgentAvailability,
  setConversationStatus,
  transferConversation,
} from './api';
import {
  LoadState,
  Filter,
  AgentConversationDrafts,
  PendingAgentText,
  InboxRealtimeEvent,
  ThreadRealtimeEvent,
  UiIcon,
  filterLabels,
  AGENT_TYPING_IDLE_MS,
  REMOTE_TYPING_STALE_MS,
  loadAgentConversationDrafts,
  saveAgentConversationDrafts,
  loadAgentSoundEnabled,
  saveAgentSoundEnabled,
  emitAgentMessageTone,
  parseRealtimeEvent,
  sortedConversationList,
  compareMessages,
  AgentLogin,
  Startup,
  Metric,
  ConversationExpiryCountdown,
  Bubble,
  initials,
  relativeTime,
  message,
} from './dashboard-shared';
import { AgentStatisticsModal } from './AgentStatisticsWorkspace';
import { sendAgentImage, type AgentMediaItem } from './agent-media';
import {
  disableAgentNotifications,
  enableAgentNotifications,
  prepareAgentNotifications,
  type AgentNotificationState,
} from './agent-push';

export function AgentPortal() {
  const [state, setState] = useState<LoadState>('loading');
  const [identity, setIdentity] = useState<AgentIdentity | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getAgentSession()
      .then((session) => {
        setIdentity(session.agent);
        setState(session.authenticated ? 'authenticated' : 'signed-out');
      })
      .catch(() => setState('signed-out'));
  }, []);

  if (state === 'loading') return <Startup label="正在加载客服工作台…" />;
  if (state === 'signed-out' || !identity) {
    return (
      <AgentLogin
        username={username}
        password={password}
        error={error}
        onUsername={setUsername}
        onPassword={setPassword}
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          try {
            const agent = await agentLogin(username, password);
            setIdentity(agent);
            setPassword('');
            setState('authenticated');
          } catch (reason) {
            setError(message(reason, '登录失败'));
          }
        }}
      />
    );
  }

  const onLogout = async () => {
    await agentLogout();
    setIdentity(null);
    setState('signed-out');
  };

  return <AgentWorkspace identity={identity} onLogout={onLogout} />;
}

function AgentWorkspace({
  identity,
  onLogout,
}: {
  identity: AgentIdentity;
  onLogout: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadFirst, setUnreadFirst] = useState(true);
  const [notificationState, setNotificationState] =
    useState<AgentNotificationState>('disabled');
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() =>
    loadAgentSoundEnabled(identity.id),
  );
  const [availability, setAvailability] = useState<AgentAvailability>(
    identity.status === 'busy' ? 'busy' : 'online',
  );
  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const [statisticsOpen, setStatisticsOpen] = useState(() =>
    window.location.pathname.startsWith('/agent/stats'),
  );
  const [overview, setOverview] = useState({
    open: 0,
    pending: 0,
    closed: 0,
    total: 0,
    todayAccepted: 0,
    dailyLimit: 0,
    trafficQuotaEnabled: false,
    trafficQuotaTotal: 0,
    trafficQuotaUsed: 0,
    trafficQuotaRemaining: 0,
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [transferTargets, setTransferTargets] = useState<TransferTarget[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false);
  const [quickReplySearch, setQuickReplySearch] = useState('');
  const [quickReplyActiveIndex, setQuickReplyActiveIndex] = useState(0);
  const [quickReplyTitle, setQuickReplyTitle] = useState('');
  const [quickReplyBody, setQuickReplyBody] = useState('');
  const [quickReplySaving, setQuickReplySaving] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [mediaItems, setMediaItems] = useState<AgentMediaItem[]>([]);
  const [mediaProgress, setMediaProgress] = useState<number | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaPendingFile, setMediaPendingFile] = useState<File | null>(null);
  const [mediaClientUploadId, setMediaClientUploadId] = useState<string | null>(
    null,
  );
  const [mediaFailed, setMediaFailed] = useState(false);
  const [drafts, setDrafts] = useState<AgentConversationDrafts>(() =>
    loadAgentConversationDrafts(identity.id),
  );
  const [pendingTextMessages, setPendingTextMessages] = useState<
    Record<string, PendingAgentText>
  >({});
  const [inboxConnected, setInboxConnected] = useState(false);
  const [threadConnected, setThreadConnected] = useState(false);
  const [visitorTyping, setVisitorTyping] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const quickReplySearchRef = useRef<HTMLInputElement | null>(null);
  const detailRef = useRef<ConversationDetail | null>(null);
  const threadSocketRef = useRef<WebSocket | null>(null);
  const agentTypingDesiredRef = useRef(false);
  const agentTypingSentRef = useRef(false);
  const agentTypingTimerRef = useRef<number | null>(null);
  const visitorTypingTimerRef = useRef<number | null>(null);
  const soundEnabledRef = useRef(soundEnabled);
  const soundContextRef = useRef<AudioContext | null>(null);
  const unreadCountRef = useRef(new Map<string, number>());
  const lastScrolledConversationRef = useRef<string | null>(null);
  const baseTitleRef = useRef(document.title);
  const draft = selectedId ? (drafts[selectedId]?.body ?? '') : '';
  const currentPendingText = selectedId
    ? (pendingTextMessages[selectedId] ?? null)
    : null;
  const realtimeConnected = inboxConnected && (!selectedId || threadConnected);
  const connectionState = !networkOnline
    ? 'offline'
    : realtimeConnected
      ? 'connected'
      : busy
        ? 'connecting'
        : 'reconnecting';
  const totalUnread = useMemo(
    () => conversations.reduce((sum, item) => sum + item.agent_unread_count, 0),
    [conversations],
  );
  const visibleConversations = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('zh-CN');
    const filtered = conversations.filter((conversation) => {
      if (filter !== 'all' && conversation.status !== filter) return false;
      if (!query) return true;
      return [
        conversation.visitor_name,
        conversation.product_title,
        conversation.subject,
        conversation.last_message,
      ].some((value) => value?.toLocaleLowerCase('zh-CN').includes(query));
    });
    if (!unreadFirst) return filtered;
    return [...filtered].sort((left, right) => {
      const unreadDifference =
        Number(right.agent_unread_count > 0) -
        Number(left.agent_unread_count > 0);
      if (unreadDifference) return unreadDifference;
      return (
        new Date(right.last_message_at).getTime() -
        new Date(left.last_message_at).getTime()
      );
    });
  }, [conversations, filter, searchQuery, unreadFirst]);
  const filteredQuickReplies = useMemo(() => {
    const query = quickReplySearch.trim().toLocaleLowerCase('zh-CN');
    if (!query) return quickReplies;
    return quickReplies.filter((reply) =>
      [reply.title, reply.body].some((value) =>
        value.toLocaleLowerCase('zh-CN').includes(query),
      ),
    );
  }, [quickReplies, quickReplySearch]);
  const lastVisibleVisitorMessageId = useMemo(
    () =>
      detail?.messages
        .slice()
        .reverse()
        .find((item) => item.sender_type === 'visitor')?.id ?? null,
    [detail],
  );

  useEffect(() => {
    if (!window.location.pathname.startsWith('/agent/stats')) return;
    window.history.replaceState(null, '', '/agent');
  }, []);

  useEffect(() => {
    let active = true;
    void prepareAgentNotifications()
      .then((state) => {
        if (active) setNotificationState(state);
      })
      .catch(() => {
        if (active) setNotificationState('unsupported');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    saveAgentConversationDrafts(identity.id, drafts);
  }, [drafts, identity.id]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    saveAgentSoundEnabled(identity.id, soundEnabled);
  }, [identity.id, soundEnabled]);

  const ensureSoundContext = useCallback((): AudioContext | null => {
    if (soundContextRef.current) return soundContextRef.current;
    try {
      soundContextRef.current = new AudioContext();
      return soundContextRef.current;
    } catch {
      return null;
    }
  }, []);

  const playIncomingTone = useCallback(() => {
    if (!soundEnabledRef.current || document.visibilityState !== 'visible') {
      return;
    }
    const context = ensureSoundContext();
    if (!context) return;
    if (context.state === 'running') {
      emitAgentMessageTone(context);
      return;
    }
    void context
      .resume()
      .then(() => emitAgentMessageTone(context))
      .catch(() => undefined);
  }, [ensureSoundContext]);

  useEffect(() => {
    const primeSound = () => {
      if (!soundEnabledRef.current) return;
      const context = ensureSoundContext();
      if (context?.state === 'suspended') {
        void context.resume().catch(() => undefined);
      }
    };
    window.addEventListener('pointerdown', primeSound, { once: true });
    window.addEventListener('keydown', primeSound, { once: true });
    return () => {
      window.removeEventListener('pointerdown', primeSound);
      window.removeEventListener('keydown', primeSound);
    };
  }, [ensureSoundContext]);

  useEffect(
    () => () => {
      if (soundContextRef.current) {
        void soundContextRef.current.close().catch(() => undefined);
        soundContextRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  useEffect(() => {
    const online = () => setNetworkOnline(true);
    const offline = () => setNetworkOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  const acknowledgeConversation = useCallback(
    async (id: string, lastMessageId: string | null = null) => {
      await markConversationRead(id, lastMessageId);
      unreadCountRef.current.set(id, 0);
      setConversations((current) =>
        current.map((item) =>
          item.id === id ? { ...item, agent_unread_count: 0 } : item,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    const baseTitle = baseTitleRef.current;
    document.title =
      totalUnread > 0 ? `(${totalUnread}) ${baseTitle}` : baseTitle;
    return () => {
      document.title = baseTitle;
    };
  }, [totalUnread]);

  const applyInbox = useCallback((inbox: AgentInbox) => {
    setOverview(inbox.overview);
    setConversations(inbox.conversations);
    unreadCountRef.current = new Map(
      inbox.conversations.map((conversation) => [
        conversation.id,
        conversation.agent_unread_count,
      ]),
    );
    setTransferTargets(inbox.transferTargets);
    setQuickReplies(inbox.quickReplies);
    setAvailability(inbox.availability);
  }, []);

  const refresh = useCallback(async () => {
    const inbox = await getAgentInbox();
    applyInbox(inbox);
  }, [applyInbox]);

  useEffect(() => {
    setBusy(true);
    refresh()
      .catch((reason) => setError(message(reason, '无法加载会话')))
      .finally(() => setBusy(false));
  }, [refresh]);

  useEffect(() => {
    const recover = () => {
      if (document.visibilityState !== 'visible') return;
      void heartbeat()
        .then(applyInbox)
        .catch(() => void refresh().catch(() => undefined));
      if (selectedId) {
        void acknowledgeConversation(
          selectedId,
          lastVisibleVisitorMessageId,
        ).catch(() => undefined);
      }
    };

    document.addEventListener('visibilitychange', recover);
    window.addEventListener('online', recover);
    return () => {
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('online', recover);
    };
  }, [
    acknowledgeConversation,
    applyInbox,
    lastVisibleVisitorMessageId,
    refresh,
    selectedId,
  ]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    let stableTimer: number | null = null;
    let openedOnce = false;
    let retryAttempt = 0;
    const connect = () => {
      if (!active) return;
      socket = openAgentInboxSocket();
      socket.addEventListener('open', () => {
        if (!active) return;
        setInboxConnected(true);
        if (stableTimer !== null) window.clearTimeout(stableTimer);
        stableTimer = window.setTimeout(() => {
          retryAttempt = 0;
        }, 10_000);
        if (openedOnce) {
          void heartbeat()
            .then(applyInbox)
            .catch(() => void refresh().catch(() => undefined));
        }
        openedOnce = true;
      });
      socket.addEventListener('message', (event) => {
        if (!active) return;
        const payload = parseRealtimeEvent<InboxRealtimeEvent>(event);
        if (!payload || payload.type === 'ready' || payload.type === 'pong')
          return;
        if (payload.type !== 'conversation.changed' || !payload.conversation) {
          void refresh().catch(() => undefined);
          return;
        }

        const next = payload.conversation;
        const belongsToAgent = next.assigned_agent === identity.id;
        const previousUnread = unreadCountRef.current.get(next.id) ?? 0;
        if (belongsToAgent) {
          unreadCountRef.current.set(next.id, next.agent_unread_count);
        } else {
          unreadCountRef.current.delete(next.id);
        }
        if (
          belongsToAgent &&
          next.agent_unread_count > previousUnread &&
          document.visibilityState === 'visible'
        ) {
          playIncomingTone();
        }
        setConversations((current) => {
          const withoutCurrent = current.filter((item) => item.id !== next.id);
          if (!belongsToAgent) return withoutCurrent;
          return sortedConversationList([next, ...withoutCurrent]);
        });
        if (belongsToAgent && payload.overview) {
          setOverview((current) => ({ ...current, ...payload.overview }));
        }
      });
      socket.addEventListener('close', () => {
        if (!active) return;
        setInboxConnected(false);
        socket = null;
        if (stableTimer !== null) window.clearTimeout(stableTimer);
        stableTimer = null;
        const delay = realtimeReconnectDelay(retryAttempt);
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
    return () => {
      active = false;
      setInboxConnected(false);
      window.removeEventListener('online', reconnectNow);
      socket?.close();
      if (timer !== null) window.clearTimeout(timer);
      if (stableTimer !== null) window.clearTimeout(stableTimer);
    };
  }, [applyInbox, identity.id, playIncomingTone, refresh]);

  const sendAgentTyping = useCallback((active: boolean) => {
    agentTypingDesiredRef.current = active;
    const socket = threadSocketRef.current;
    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      agentTypingSentRef.current === active
    ) {
      return;
    }
    try {
      socket.send(JSON.stringify({ type: 'typing', active }));
      agentTypingSentRef.current = active;
    } catch {
      // Reconnect recovery sends the current typing state on the new socket.
    }
  }, []);

  const updateAgentTyping = useCallback(
    (value: string) => {
      if (agentTypingTimerRef.current !== null) {
        window.clearTimeout(agentTypingTimerRef.current);
        agentTypingTimerRef.current = null;
      }
      const active = Boolean(value.trim());
      sendAgentTyping(active);
      if (!active) return;
      agentTypingTimerRef.current = window.setTimeout(() => {
        agentTypingTimerRef.current = null;
        sendAgentTyping(false);
      }, AGENT_TYPING_IDLE_MS);
    },
    [sendAgentTyping],
  );

  useEffect(() => {
    setQuickRepliesOpen(false);
    setQuickReplySearch('');
    setVisitorTyping(false);
    if (visitorTypingTimerRef.current !== null) {
      window.clearTimeout(visitorTypingTimerRef.current);
      visitorTypingTimerRef.current = null;
    }
    if (agentTypingTimerRef.current !== null) {
      window.clearTimeout(agentTypingTimerRef.current);
      agentTypingTimerRef.current = null;
    }
    agentTypingDesiredRef.current = false;
    agentTypingSentRef.current = false;
    if (!selectedId) {
      setDetail(null);
      setMediaItems([]);
      setThreadConnected(false);
      lastScrolledConversationRef.current = null;
      return;
    }
    let active = true;
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    let stableTimer: number | null = null;
    let openedOnce = false;
    let retryAttempt = 0;
    const load = (incremental = false) => {
      const current = detailRef.current;
      const lastMessage =
        incremental && current?.conversation.id === selectedId
          ? current.messages.at(-1)
          : null;
      return getConversation(
        selectedId,
        lastMessage
          ? { id: lastMessage.id, createdAt: lastMessage.created_at }
          : null,
      )
        .then((value) => {
          if (active) {
            setDetail((currentDetail) => {
              if (
                !incremental ||
                !currentDetail ||
                currentDetail.conversation.id !== selectedId
              ) {
                return value;
              }
              const messages = new Map(
                currentDetail.messages.map((item) => [item.id, item]),
              );
              for (const readState of value.readState ?? []) {
                const existing = messages.get(readState.id);
                if (existing)
                  messages.set(readState.id, { ...existing, ...readState });
              }
              for (const item of value.messages) messages.set(item.id, item);
              return {
                ...value,
                messages: [...messages.values()].sort(compareMessages),
              };
            });
            const deliveredClientIds = new Set(
              value.messages
                .map((item) => item.client_message_id)
                .filter((id): id is string => Boolean(id)),
            );
            setPendingTextMessages((current) => {
              const pending = current[selectedId];
              if (
                !pending ||
                !deliveredClientIds.has(pending.clientMessageId)
              ) {
                return current;
              }
              const next = { ...current };
              delete next[selectedId];
              return next;
            });
            const incomingMedia = value.media.map((item) => ({
              ...item,
              url: `/api/agent/media/${encodeURIComponent(item.id)}/content`,
            }));
            setMediaItems((currentMedia) => {
              if (!incremental) return incomingMedia;
              const media = new Map(
                currentMedia.map((item) => [item.id, item]),
              );
              for (const item of incomingMedia) media.set(item.id, item);
              return [...media.values()];
            });
            if (document.visibilityState === 'visible') {
              const lastVisitorMessageId =
                value.messages
                  .slice()
                  .reverse()
                  .find((item) => item.sender_type === 'visitor')?.id ?? null;
              void acknowledgeConversation(
                selectedId,
                lastVisitorMessageId,
              ).catch(() => undefined);
            }
          }
        })
        .catch((reason) => {
          if (active) setError(message(reason, '无法加载会话'));
        });
    };
    const connect = () => {
      if (!active) return;
      socket = openConversationSocket(selectedId);
      threadSocketRef.current = socket;
      socket.addEventListener('open', () => {
        if (!active) return;
        setThreadConnected(true);
        agentTypingSentRef.current = false;
        if (agentTypingDesiredRef.current) sendAgentTyping(true);
        if (stableTimer !== null) window.clearTimeout(stableTimer);
        stableTimer = window.setTimeout(() => {
          retryAttempt = 0;
        }, 10_000);
        if (openedOnce) void load(true);
        openedOnce = true;
      });
      socket.addEventListener('message', (event) => {
        if (!active) return;
        const payload = parseRealtimeEvent<ThreadRealtimeEvent>(event);
        if (!payload || payload.type === 'ready' || payload.type === 'pong')
          return;

        if (
          payload.type === 'typing' &&
          payload.actor === 'visitor' &&
          typeof payload.active === 'boolean'
        ) {
          if (visitorTypingTimerRef.current !== null) {
            window.clearTimeout(visitorTypingTimerRef.current);
          }
          setVisitorTyping(payload.active);
          visitorTypingTimerRef.current = payload.active
            ? window.setTimeout(() => {
                visitorTypingTimerRef.current = null;
                setVisitorTyping(false);
              }, REMOTE_TYPING_STALE_MS)
            : null;
          return;
        }

        if (payload.type === 'conversation.transferred') {
          setSelectedId(null);
          setDetail(null);
          void refresh().catch(() => undefined);
          return;
        }

        if (payload.type === 'message' && payload.message) {
          const incoming = payload.message;
          if (incoming.sender_type === 'visitor') {
            setVisitorTyping(false);
            if (visitorTypingTimerRef.current !== null) {
              window.clearTimeout(visitorTypingTimerRef.current);
              visitorTypingTimerRef.current = null;
            }
          }
          if (incoming.client_message_id) {
            setPendingTextMessages((current) => {
              const pending = current[selectedId];
              if (pending?.clientMessageId !== incoming.client_message_id) {
                return current;
              }
              const next = { ...current };
              delete next[selectedId];
              return next;
            });
          }
          setDetail((current) => {
            if (!current || current.conversation.id !== selectedId)
              return current;
            const exists = current.messages.some(
              (item) => item.id === incoming.id,
            );
            return {
              ...current,
              conversation: {
                ...current.conversation,
                last_message: incoming.body,
                last_message_at: incoming.created_at,
              },
              messages: exists
                ? current.messages.map((item) =>
                    item.id === incoming.id ? incoming : item,
                  )
                : [...current.messages, incoming],
            };
          });
          if (payload.media?.id && payload.media.messageId) {
            const media: AgentMediaItem = {
              ...payload.media,
              url: `/api/agent/media/${encodeURIComponent(payload.media.id)}/content`,
            };
            setMediaItems((current) =>
              current.some((item) => item.id === media.id)
                ? current.map((item) => (item.id === media.id ? media : item))
                : [...current, media],
            );
          }
          if (
            incoming.sender_type === 'visitor' &&
            document.visibilityState === 'visible'
          ) {
            void acknowledgeConversation(selectedId, incoming.id).catch(
              () => undefined,
            );
          }
          return;
        }

        if (payload.type === 'message.read') {
          const readAt = new Date().toISOString();
          setDetail((current) => {
            if (!current || current.conversation.id !== selectedId)
              return current;
            return {
              ...current,
              messages: current.messages.map((item) => {
                if (
                  payload.reader === 'visitor' &&
                  item.sender_type === 'agent'
                ) {
                  return {
                    ...item,
                    read_by_visitor_at: item.read_by_visitor_at ?? readAt,
                  };
                }
                if (
                  payload.reader === 'agent' &&
                  item.sender_type === 'visitor'
                ) {
                  return {
                    ...item,
                    read_by_agent_at: item.read_by_agent_at ?? readAt,
                  };
                }
                return item;
              }),
            };
          });
          return;
        }

        if (payload.type === 'conversation.status' && payload.status) {
          setDetail((current) =>
            current && current.conversation.id === selectedId
              ? {
                  ...current,
                  conversation: {
                    ...current.conversation,
                    status: payload.status!,
                  },
                }
              : current,
          );
          setConversations((current) =>
            current.map((item) =>
              item.id === selectedId
                ? { ...item, status: payload.status! }
                : item,
            ),
          );
          return;
        }

        void load();
      });
      socket.addEventListener('close', () => {
        if (!active) return;
        setThreadConnected(false);
        if (threadSocketRef.current === socket) threadSocketRef.current = null;
        agentTypingSentRef.current = false;
        socket = null;
        if (stableTimer !== null) window.clearTimeout(stableTimer);
        stableTimer = null;
        const delay = realtimeReconnectDelay(retryAttempt);
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
    void load(false);
    connect();
    window.addEventListener('online', reconnectNow);
    return () => {
      active = false;
      setThreadConnected(false);
      window.removeEventListener('online', reconnectNow);
      if (socket?.readyState === WebSocket.OPEN && agentTypingSentRef.current) {
        try {
          socket.send(JSON.stringify({ type: 'typing', active: false }));
        } catch {
          // The socket may already be closing.
        }
      }
      if (threadSocketRef.current === socket) threadSocketRef.current = null;
      socket?.close();
      agentTypingDesiredRef.current = false;
      agentTypingSentRef.current = false;
      if (agentTypingTimerRef.current !== null) {
        window.clearTimeout(agentTypingTimerRef.current);
        agentTypingTimerRef.current = null;
      }
      if (visitorTypingTimerRef.current !== null) {
        window.clearTimeout(visitorTypingTimerRef.current);
        visitorTypingTimerRef.current = null;
      }
      if (timer !== null) window.clearTimeout(timer);
      if (stableTimer !== null) window.clearTimeout(stableTimer);
    };
  }, [acknowledgeConversation, refresh, selectedId, sendAgentTyping]);

  const lastMessageId = detail?.messages.at(-1)?.id ?? null;
  const selectedExpiresAt = detail?.conversation.expires_at ?? null;

  useEffect(() => {
    setMediaPendingFile(null);
    setMediaClientUploadId(null);
    setMediaFailed(false);
    setMediaProgress(null);
    setMediaPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !selectedExpiresAt) return;
    const expiresAt = Date.parse(selectedExpiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const expire = () => {
      setSelectedId(null);
      setDetail(null);
      setMediaItems([]);
      void refresh().catch(() => undefined);
    };
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      expire();
      return;
    }
    const timer = window.setTimeout(expire, remaining + 100);
    return () => window.clearTimeout(timer);
  }, [refresh, selectedExpiresAt, selectedId]);
  useLayoutEffect(() => {
    const timeline = messagesRef.current;
    if (!timeline || !selectedId) return;
    const isOpeningConversation =
      lastScrolledConversationRef.current !== selectedId;
    const scroll = () => {
      if (isOpeningConversation) {
        timeline.scrollTop = timeline.scrollHeight;
        lastScrolledConversationRef.current = selectedId;
        return;
      }
      timeline.scrollTo({ top: timeline.scrollHeight, behavior: 'smooth' });
    };
    scroll();
    const frame = window.requestAnimationFrame(scroll);
    return () => window.cancelAnimationFrame(frame);
  }, [
    currentPendingText?.clientMessageId,
    currentPendingText?.status,
    lastMessageId,
    selectedId,
  ]);

  function updateDraft(value: string | ((current: string) => string)) {
    if (!selectedId) return;
    setDrafts((current) => {
      const previous = current[selectedId]?.body ?? '';
      const nextBody = typeof value === 'function' ? value(previous) : value;
      const next = { ...current };
      if (!nextBody) {
        delete next[selectedId];
      } else {
        next[selectedId] = { body: nextBody, updatedAt: Date.now() };
      }
      return next;
    });
  }

  function clearConversationDraft(conversationId: string) {
    setDrafts((current) => {
      if (!current[conversationId]) return current;
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  }

  async function deliverTextMessage(pending: PendingAgentText) {
    setPendingTextMessages((current) => ({
      ...current,
      [pending.conversationId]: { ...pending, status: 'sending' },
    }));
    try {
      const sent = await sendMessage(
        pending.conversationId,
        pending.body,
        pending.clientMessageId,
      );
      setDetail((current) => {
        if (!current || current.conversation.id !== pending.conversationId) {
          return current;
        }
        const exists = current.messages.some((item) => item.id === sent.id);
        return {
          ...current,
          conversation: {
            ...current.conversation,
            last_message: sent.body,
            last_message_at: sent.created_at,
          },
          messages: exists ? current.messages : [...current.messages, sent],
        };
      });
      setPendingTextMessages((current) => {
        if (
          current[pending.conversationId]?.clientMessageId !==
          pending.clientMessageId
        ) {
          return current;
        }
        const next = { ...current };
        delete next[pending.conversationId];
        return next;
      });
    } catch (reason) {
      setPendingTextMessages((current) => {
        if (
          current[pending.conversationId]?.clientMessageId !==
          pending.clientMessageId
        ) {
          return current;
        }
        return {
          ...current,
          [pending.conversationId]: { ...pending, status: 'failed' },
        };
      });
      setError(message(reason, '消息发送失败，可点击消息重试'));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !draft.trim() || currentPendingText) return;
    sendAgentTyping(false);
    if (agentTypingTimerRef.current !== null) {
      window.clearTimeout(agentTypingTimerRef.current);
      agentTypingTimerRef.current = null;
    }
    const pending: PendingAgentText = {
      conversationId: selectedId,
      clientMessageId: crypto.randomUUID(),
      body: draft.trim(),
      status: 'sending',
    };
    updateDraft('');
    await deliverTextMessage(pending);
  }

  async function retryTextMessage() {
    if (!currentPendingText || currentPendingText.status !== 'failed') return;
    await deliverTextMessage(currentPendingText);
  }

  function editFailedTextMessage() {
    if (!selectedId || currentPendingText?.status !== 'failed') return;
    const failedBody = currentPendingText.body;
    setPendingTextMessages((current) => {
      const next = { ...current };
      delete next[selectedId];
      return next;
    });
    updateDraft((current) =>
      current.trim() ? `${failedBody}\n${current.trimStart()}` : failedBody,
    );
  }

  async function uploadImage(
    file: File,
    previewUrl: string,
    clientUploadId: string,
  ) {
    if (!selectedId) return;
    setMediaProgress(0);
    setMediaFailed(false);
    try {
      const sent = await sendAgentImage(
        selectedId,
        file,
        clientUploadId,
        setMediaProgress,
      );
      const message: Message = {
        id: sent.messageId,
        conversation_id: selectedId,
        sender_type: 'agent',
        sender_id: identity.id,
        body: '',
        client_message_id: null,
        read_by_visitor_at: null,
        read_by_agent_at: null,
        created_at: sent.createdAt,
      };
      setDetail((current) => {
        if (!current || current.conversation.id !== selectedId) return current;
        const exists = current.messages.some((item) => item.id === message.id);
        return {
          ...current,
          conversation: {
            ...current.conversation,
            last_message: '',
            last_message_at: sent.createdAt,
          },
          messages: exists ? current.messages : [...current.messages, message],
        };
      });
      setMediaItems((current) =>
        current.some((item) => item.id === sent.media.id)
          ? current.map((item) =>
              item.id === sent.media.id ? sent.media : item,
            )
          : [...current, sent.media],
      );
      setMediaPendingFile(null);
      setMediaClientUploadId(null);
      setMediaPreviewUrl(null);
      URL.revokeObjectURL(previewUrl);
    } catch (reason) {
      setMediaFailed(true);
      setError(message(reason, '图片发送失败'));
    } finally {
      setMediaProgress(null);
    }
  }

  async function submitImage(file: File) {
    if (!selectedId) return;
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    const previewUrl = URL.createObjectURL(file);
    setMediaPreviewUrl(previewUrl);
    setMediaPendingFile(file);
    const clientUploadId = crypto.randomUUID();
    setMediaClientUploadId(clientUploadId);
    await uploadImage(file, previewUrl, clientUploadId);
  }

  async function retryImage() {
    if (
      !mediaPendingFile ||
      !mediaPreviewUrl ||
      !mediaClientUploadId ||
      mediaProgress !== null
    )
      return;
    await uploadImage(mediaPendingFile, mediaPreviewUrl, mediaClientUploadId);
  }

  async function changeStatus(status: Conversation['status']) {
    if (!selectedId) return;
    const previousStatus = detail?.conversation.status as
      Conversation['status'] | undefined;
    try {
      await setConversationStatus(selectedId, status);
      setDetail((current) =>
        current && current.conversation.id === selectedId
          ? {
              ...current,
              conversation: { ...current.conversation, status },
            }
          : current,
      );
      setConversations((current) =>
        current.map((item) =>
          item.id === selectedId ? { ...item, status } : item,
        ),
      );
      if (previousStatus && previousStatus !== status) {
        setOverview((current) => ({
          ...current,
          [previousStatus]: Math.max(0, current[previousStatus] - 1),
          [status]: current[status] + 1,
        }));
      }
      if (status === 'closed') {
        clearConversationDraft(selectedId);
        setPendingTextMessages((current) => {
          if (!current[selectedId]) return current;
          const next = { ...current };
          delete next[selectedId];
          return next;
        });
      }
    } catch (reason) {
      setError(message(reason, '更新会话状态失败'));
    }
  }

  async function toggleAvailability() {
    if (availabilitySaving) return;
    const nextStatus: AgentAvailability =
      availability === 'online' ? 'busy' : 'online';
    setAvailabilitySaving(true);
    try {
      applyInbox(await setAgentAvailability(nextStatus));
    } catch (reason) {
      setError(message(reason, '切换接待状态失败'));
    } finally {
      setAvailabilitySaving(false);
    }
  }

  async function toggleNotifications() {
    if (notificationBusy || notificationState === 'unsupported') return;
    if (notificationState === 'blocked') {
      setError('浏览器已阻止通知，请在站点权限中重新开启');
      return;
    }
    setNotificationBusy(true);
    try {
      const nextState =
        notificationState === 'enabled'
          ? await disableAgentNotifications()
          : await enableAgentNotifications();
      setNotificationState(nextState);
      if (nextState === 'blocked') {
        setError('浏览器已阻止通知，请在站点权限中重新开启');
      }
    } catch (reason) {
      setError(message(reason, '通知设置失败'));
    } finally {
      setNotificationBusy(false);
    }
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundEnabledRef.current = next;
    if (!next) return;
    const context = ensureSoundContext();
    if (!context) return;
    if (context.state === 'running') {
      emitAgentMessageTone(context);
      return;
    }
    void context
      .resume()
      .then(() => emitAgentMessageTone(context))
      .catch(() => undefined);
  }

  async function logoutFromWorkspace() {
    if (notificationState === 'enabled') {
      await disableAgentNotifications().catch(() => undefined);
    }
    await onLogout();
  }

  async function handoffConversation(targetAgentId: string | null) {
    if (!selectedId || transferring) return;
    setTransferring(true);
    try {
      await transferConversation(selectedId, targetAgentId);
      clearConversationDraft(selectedId);
      setPendingTextMessages((current) => {
        if (!current[selectedId]) return current;
        const next = { ...current };
        delete next[selectedId];
        return next;
      });
      setSelectedId(null);
      setDetail(null);
      await refresh();
    } catch (reason) {
      setError(message(reason, '转接会话失败'));
    } finally {
      setTransferring(false);
    }
  }

  async function saveQuickReply() {
    if (!quickReplyTitle.trim() || !quickReplyBody.trim() || quickReplySaving)
      return;
    setQuickReplySaving(true);
    try {
      const reply = await createQuickReply({
        title: quickReplyTitle,
        body: quickReplyBody,
      });
      setQuickReplies((current) => [reply, ...current]);
      setQuickReplyTitle('');
      setQuickReplyBody('');
    } catch (reason) {
      setError(message(reason, '保存快捷回复失败'));
    } finally {
      setQuickReplySaving(false);
    }
  }

  async function removeQuickReply(id: string) {
    try {
      await deleteQuickReply(id);
      setQuickReplies((current) => current.filter((reply) => reply.id !== id));
    } catch (reason) {
      setError(message(reason, '删除快捷回复失败'));
    }
  }

  function applyQuickReply(reply: QuickReply) {
    updateDraft((current) =>
      current.trim() ? `${current.trimEnd()}\n${reply.body}` : reply.body,
    );
    setQuickRepliesOpen(false);
    setQuickReplySearch('');
    setQuickReplyActiveIndex(0);
  }

  function openQuickReplies() {
    setQuickRepliesOpen(true);
    setQuickReplySearch('');
    setQuickReplyActiveIndex(0);
    window.requestAnimationFrame(() => quickReplySearchRef.current?.focus());
  }

  function closeQuickReplies() {
    setQuickRepliesOpen(false);
    setQuickReplySearch('');
    setQuickReplyActiveIndex(0);
  }

  return (
    <div className={`workspace-shell${selectedId ? ' is-thread-open' : ''}`}>
      <aside className="workspace-sidebar">
        <div className="workspace-brand-lockup">
          <div className="workspace-brand">CS</div>
          <span>坐席中心</span>
        </div>
        <div className="agent-profile">
          <span className="avatar">{initials(identity.name)}</span>
          <div>
            <strong>{identity.name}</strong>
            <small>@{identity.username}</small>
          </div>
          <i className={`presence ${availability}`} />
        </div>
        <div className="workspace-sidebar-actions">
          <button
            type="button"
            className={`ghost-button full workspace-notification-button${notificationState === 'enabled' ? ' is-enabled' : ''}`}
            aria-label={
              notificationState === 'enabled'
                ? '关闭新消息通知'
                : '开启新消息通知'
            }
            title={
              notificationState === 'unsupported'
                ? '当前浏览器不支持后台通知'
                : notificationState === 'blocked'
                  ? '通知已被浏览器阻止'
                  : notificationState === 'enabled'
                    ? '新消息通知已开启'
                    : '开启新消息通知'
            }
            disabled={notificationBusy || notificationState === 'unsupported'}
            onClick={() => void toggleNotifications()}
          >
            <UiIcon name="notification" />
            <span>
              {notificationBusy
                ? '正在设置…'
                : notificationState === 'enabled'
                  ? '新消息通知已开启'
                  : notificationState === 'blocked'
                    ? '通知已被阻止'
                    : '开启新消息通知'}
            </span>
          </button>
          <button
            type="button"
            className={`ghost-button full workspace-sound-button${soundEnabled ? ' is-enabled' : ''}`}
            aria-pressed={soundEnabled}
            aria-label={
              soundEnabled ? '关闭前台消息提示音' : '开启前台消息提示音'
            }
            title={
              soundEnabled ? '前台消息提示音已开启' : '前台消息提示音已静音'
            }
            onClick={toggleSound}
          >
            <UiIcon name="sound" />
            <span>
              {soundEnabled ? '前台提示音已开启' : '前台提示音已静音'}
            </span>
          </button>
          <button
            type="button"
            className="ghost-button full workspace-statistics-button"
            aria-label="打开接待流量"
            title="接待流量"
            onClick={() => setStatisticsOpen(true)}
          >
            <UiIcon name="statistics" />
            <span>接待流量</span>
          </button>
          <button
            type="button"
            className="ghost-button full workspace-logout-button"
            aria-label="退出客服账号"
            title="退出客服账号"
            onClick={() => void logoutFromWorkspace()}
          >
            <UiIcon name="logout" />
            <span>退出客服账号</span>
          </button>
        </div>
      </aside>

      <section className="conversation-pane">
        <header className="conversation-head">
          <div>
            <span className="eyebrow">坐席收件箱</span>
            <h1>
              我的会话
              {totalUnread > 0 && (
                <span className="unread-total">{totalUnread}</span>
              )}
            </h1>
          </div>
          <div className="conversation-head-status">
            <button
              type="button"
              className={`availability-pill is-${availability}`}
              aria-pressed={availability === 'busy'}
              disabled={availabilitySaving || !networkOnline || !inboxConnected}
              title={
                availability === 'online'
                  ? '点击暂停接收新会话'
                  : '点击恢复接收新会话'
              }
              onClick={() => void toggleAvailability()}
            >
              <span aria-hidden="true" />
              {availabilitySaving
                ? '切换中…'
                : availability === 'online'
                  ? '在线接待'
                  : '暂停接待'}
            </button>
            <span
              className={`connection-status is-${connectionState}`}
              aria-live="polite"
            >
              <i aria-hidden="true" />
              {connectionState === 'connected'
                ? '实时连接正常'
                : connectionState === 'offline'
                  ? '网络已断开 · 草稿已保存'
                  : connectionState === 'connecting'
                    ? '正在建立连接'
                    : '连接中断 · 正在恢复'}
            </span>
          </div>
        </header>
        <div className="inbox-overview" aria-label="会话概览">
          <Metric label="新会话" value={overview.open} />
          <Metric label="处理中" value={overview.pending} />
          <Metric label="已关闭" value={overview.closed} />
          <Metric
            label="剩余额度"
            value={
              overview.trafficQuotaEnabled
                ? overview.trafficQuotaRemaining
                : '不限'
            }
          />
        </div>
        <div className="filters">
          {(Object.keys(filterLabels) as Filter[]).map((item) => (
            <button
              type="button"
              key={item}
              className={filter === item ? 'filter active' : 'filter'}
              onClick={() => setFilter(item)}
            >
              {filterLabels[item]}
            </button>
          ))}
        </div>
        <div className="inbox-tools">
          <label className="inbox-search">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              placeholder="搜索访客、产品或消息"
              aria-label="搜索会话"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={`unread-first-toggle${unreadFirst ? ' is-active' : ''}`}
            aria-pressed={unreadFirst}
            onClick={() => setUnreadFirst((current) => !current)}
          >
            未读优先
          </button>
        </div>
        <div className="conversation-list">
          {busy ? (
            <div className="empty-state">正在加载…</div>
          ) : visibleConversations.length === 0 ? (
            <div className="empty-state">
              <strong>
                {conversations.length === 0
                  ? '当前没有分配给你的会话'
                  : '没有找到匹配的会话'}
              </strong>
              {conversations.length === 0 && (
                <span>
                  保持在线，负责产品的新会话会在对应在线客服之间自动轮询。
                </span>
              )}
            </div>
          ) : (
            visibleConversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                className={[
                  'conversation-row',
                  conversation.id === selectedId ? 'selected' : '',
                  conversation.agent_unread_count > 0 ? 'unread' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelectedId(conversation.id)}
              >
                <span className="avatar small">
                  {initials(conversation.visitor_name || '访客')}
                </span>
                <span className="conversation-copy">
                  <span>
                    <strong>
                      {conversation.visitor_name || '访客'}
                      {conversation.agent_unread_count > 0 && (
                        <span className="unread-badge">
                          {conversation.status === 'open'
                            ? `新 · ${Math.min(conversation.agent_unread_count, 99)}`
                            : Math.min(conversation.agent_unread_count, 99)}
                        </span>
                      )}
                    </strong>
                    <time>{relativeTime(conversation.last_message_at)}</time>
                  </span>
                  <small>
                    {conversation.product_title ||
                      conversation.subject ||
                      '访客咨询'}
                  </small>
                  <p>{conversation.last_message || '会话已创建'}</p>
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      <main className="thread-pane">
        {error && (
          <button
            type="button"
            className="notice error floating"
            onClick={() => setError('')}
          >
            {error}
          </button>
        )}
        {!selectedId ? (
          <div className="thread-empty">
            <strong>选择一个会话</strong>
            <span>这里只显示系统已经分配给当前客服账号的会话。</span>
          </div>
        ) : !detail ? (
          <div className="thread-empty">正在加载会话…</div>
        ) : (
          <>
            <header className="thread-head">
              <button
                type="button"
                className="thread-back-button"
                aria-label="返回会话列表"
                onClick={() => setSelectedId(null)}
              >
                ‹
              </button>
              <div className="thread-head-copy">
                <span className="eyebrow">当前访客</span>
                <h2>{String(detail.conversation.visitor_name || '访客')}</h2>
                <p>
                  {String(
                    detail.conversation.product_title ||
                      detail.conversation.subject ||
                      '访客咨询',
                  )}
                </p>
                <ConversationExpiryCountdown
                  expiresAt={detail.conversation.expires_at}
                />
              </div>
              <div className="thread-actions">
                <select
                  value={String(detail.conversation.status)}
                  onChange={(event) =>
                    void changeStatus(
                      event.target.value as Conversation['status'],
                    )
                  }
                  aria-label="会话状态"
                >
                  <option value="open">新会话</option>
                  <option value="pending">处理中</option>
                  <option value="closed">已关闭</option>
                </select>
                {detail.conversation.status !== 'closed' && (
                  <details className="transfer-menu">
                    <summary>转接</summary>
                    <div className="transfer-menu-panel">
                      <header>
                        <strong>转接会话</strong>
                        <span>交给其他在线客服，或重新进入自动分流。</span>
                      </header>
                      <button
                        type="button"
                        disabled={transferring}
                        onClick={() => void handoffConversation(null)}
                      >
                        <span>重新排队</span>
                        <small>排除当前客服后自动分流</small>
                      </button>
                      {transferTargets.map((target) => (
                        <button
                          type="button"
                          key={target.id}
                          disabled={transferring}
                          onClick={() => void handoffConversation(target.id)}
                        >
                          <span>{target.name}</span>
                          <small>
                            处理中 {target.active_count}
                            {target.max_active_conversations > 0
                              ? ` / ${target.max_active_conversations}`
                              : ''}
                          </small>
                        </button>
                      ))}
                      {transferTargets.length === 0 && (
                        <p>当前没有其他可接收会话的在线客服。</p>
                      )}
                    </div>
                  </details>
                )}
              </div>
            </header>
            {detail.conversation.product_title && (
              <div className="conversation-context-card">
                {detail.conversation.product_cover_url ? (
                  <img
                    src={detail.conversation.product_cover_url}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className="conversation-context-placeholder">CS</span>
                )}
                <div>
                  <span>咨询商品</span>
                  <strong>{detail.conversation.product_title}</strong>
                  <small>
                    {[
                      detail.conversation.section_name,
                      detail.conversation.category_name,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '商品咨询'}
                  </small>
                </div>
                {detail.conversation.product_href && (
                  <a
                    href={detail.conversation.product_href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看商品 ↗
                  </a>
                )}
              </div>
            )}
            <div className="messages" ref={messagesRef}>
              {(detail.messages as Message[]).map((item) => (
                <Bubble
                  key={item.id}
                  message={item}
                  media={
                    mediaItems.find((media) => media.messageId === item.id) ??
                    null
                  }
                />
              ))}
              {currentPendingText ? (
                <div
                  className={`message mine pending-text-message${currentPendingText.status === 'failed' ? ' is-failed' : ''}`}
                >
                  <div>
                    <p>{currentPendingText.body}</p>
                    <div className="pending-text-status">
                      <span>
                        {currentPendingText.status === 'failed'
                          ? '发送失败'
                          : '发送中…'}
                      </span>
                      {currentPendingText.status === 'failed' && (
                        <span className="pending-text-actions">
                          <button
                            type="button"
                            disabled={!networkOnline || !threadConnected}
                            onClick={() => void retryTextMessage()}
                          >
                            重试
                          </button>
                          <button type="button" onClick={editFailedTextMessage}>
                            重新编辑
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              {mediaPreviewUrl ? (
                <div className="message mine is-uploading">
                  <div>
                    <div className="message-image-pending">
                      <img
                        className="message-image"
                        src={mediaPreviewUrl}
                        alt="待发送图片"
                      />
                      <button
                        type="button"
                        className={`media-inline-status${mediaFailed ? ' is-failed' : ''}`}
                        disabled={
                          !mediaFailed ||
                          !mediaPendingFile ||
                          !networkOnline ||
                          !threadConnected
                        }
                        aria-label={mediaFailed ? '重试发送图片' : '图片发送中'}
                        onClick={() => void retryImage()}
                      >
                        {mediaFailed ? (
                          '!'
                        ) : (
                          <span
                            className="media-inline-ring"
                            style={
                              {
                                '--media-upload-progress': `${Math.round((mediaProgress ?? 0) * 360)}deg`,
                              } as CSSProperties
                            }
                          >
                            {Math.round((mediaProgress ?? 0) * 100)}
                          </span>
                        )}
                      </button>
                    </div>
                    <span className="message-meta">
                      <span>
                        {mediaFailed ? '发送失败 · 点击重试' : '发送中'}
                      </span>
                    </span>
                  </div>
                </div>
              ) : null}
              {visitorTyping ? (
                <div
                  className="visitor-typing"
                  role="status"
                  aria-live="polite"
                >
                  <span className="visitor-typing-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>访客正在输入</span>
                </div>
              ) : null}
            </div>
            <form className="composer" onSubmit={(event) => void submit(event)}>
              <div className="composer-tools">
                <label className="media-picker" aria-label="发送图片">
                  ＋
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    disabled={
                      detail.conversation.status === 'closed' ||
                      mediaProgress !== null ||
                      !networkOnline ||
                      !threadConnected
                    }
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = '';
                      if (file) void submitImage(file);
                    }}
                  />
                </label>
                <div className="quick-replies">
                  <button
                    type="button"
                    className="quick-replies-trigger"
                    aria-expanded={quickRepliesOpen}
                    disabled={detail.conversation.status === 'closed'}
                    title="快捷回复（输入 / 也可打开）"
                    onClick={() =>
                      quickRepliesOpen
                        ? closeQuickReplies()
                        : openQuickReplies()
                    }
                  >
                    <span aria-hidden="true">⚡</span>
                    <span>快捷回复</span>
                  </button>
                  {quickRepliesOpen && (
                    <div className="quick-replies-panel">
                      <header>
                        <strong>快捷回复</strong>
                        <span>搜索名称或内容，选择后仍可编辑再发送。</span>
                      </header>
                      <label className="quick-reply-search">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="11" cy="11" r="7" />
                          <path d="m20 20-4-4" />
                        </svg>
                        <input
                          ref={quickReplySearchRef}
                          type="search"
                          value={quickReplySearch}
                          placeholder="搜索快捷回复"
                          aria-label="搜索快捷回复"
                          onChange={(event) => {
                            setQuickReplySearch(event.target.value);
                            setQuickReplyActiveIndex(0);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              closeQuickReplies();
                              return;
                            }
                            if (filteredQuickReplies.length === 0) return;
                            if (event.key === 'ArrowDown') {
                              event.preventDefault();
                              setQuickReplyActiveIndex((current) =>
                                Math.min(
                                  current + 1,
                                  filteredQuickReplies.length - 1,
                                ),
                              );
                            } else if (event.key === 'ArrowUp') {
                              event.preventDefault();
                              setQuickReplyActiveIndex((current) =>
                                Math.max(0, current - 1),
                              );
                            } else if (event.key === 'Enter') {
                              event.preventDefault();
                              applyQuickReply(
                                filteredQuickReplies[
                                  Math.min(
                                    quickReplyActiveIndex,
                                    filteredQuickReplies.length - 1,
                                  )
                                ],
                              );
                            }
                          }}
                        />
                      </label>
                      {filteredQuickReplies.length > 0 && (
                        <div className="quick-replies-list">
                          {filteredQuickReplies.map((reply, index) => (
                            <div
                              key={reply.id}
                              className={
                                index === quickReplyActiveIndex
                                  ? 'is-active'
                                  : undefined
                              }
                            >
                              <button
                                type="button"
                                onClick={() => applyQuickReply(reply)}
                              >
                                <strong>{reply.title}</strong>
                                <span>{reply.body}</span>
                              </button>
                              <button
                                type="button"
                                aria-label={`删除快捷回复 ${reply.title}`}
                                onClick={() => void removeQuickReply(reply.id)}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {quickReplies.length > 0 &&
                        filteredQuickReplies.length === 0 && (
                          <div className="quick-reply-empty">
                            没有找到匹配的快捷回复
                          </div>
                        )}
                      <div className="quick-reply-create">
                        <input
                          value={quickReplyTitle}
                          maxLength={40}
                          placeholder="名称，例如：发货说明"
                          onChange={(event) =>
                            setQuickReplyTitle(event.target.value)
                          }
                        />
                        <textarea
                          value={quickReplyBody}
                          maxLength={1000}
                          rows={3}
                          placeholder="输入常用回复内容"
                          onChange={(event) =>
                            setQuickReplyBody(event.target.value)
                          }
                        />
                        <button
                          type="button"
                          disabled={
                            quickReplySaving ||
                            !quickReplyTitle.trim() ||
                            !quickReplyBody.trim()
                          }
                          onClick={() => void saveQuickReply()}
                        >
                          {quickReplySaving ? '保存中…' : '保存快捷回复'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <textarea
                value={draft}
                rows={3}
                disabled={detail.conversation.status === 'closed'}
                onChange={(event) => {
                  updateDraft(event.target.value);
                  updateAgentTyping(event.target.value);
                }}
                placeholder={
                  detail.conversation.status === 'closed'
                    ? '会话已关闭'
                    : '输入回复内容…'
                }
                onKeyDown={(event) => {
                  if (
                    event.key === '/' &&
                    !draft &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    openQuickReplies();
                    return;
                  }
                  if (event.key === 'Escape' && quickRepliesOpen) {
                    event.preventDefault();
                    closeQuickReplies();
                    return;
                  }
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                onBlur={() => sendAgentTyping(false)}
              />
              <div className="composer-foot">
                <span
                  className={`media-upload-progress${networkOnline && threadConnected ? '' : ' is-connection-warning'}`}
                >
                  {!networkOnline
                    ? '网络已断开，当前草稿已保存在本机'
                    : !threadConnected
                      ? '实时连接恢复后即可发送'
                      : 'Enter 发送 · Shift + Enter 换行'}
                </span>
                <button
                  className="primary-button"
                  disabled={
                    Boolean(currentPendingText) ||
                    !draft.trim() ||
                    detail.conversation.status === 'closed' ||
                    !networkOnline ||
                    !threadConnected
                  }
                >
                  发送
                </button>
              </div>
            </form>
          </>
        )}
      </main>
      {statisticsOpen && (
        <AgentStatisticsModal
          identity={identity}
          onClose={() => setStatisticsOpen(false)}
        />
      )}
    </div>
  );
}
