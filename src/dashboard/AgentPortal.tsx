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
  agentLogin,
  agentLogout,
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
  updateAgentNickname,
} from './api';
import { Button } from './ui';
import {
  LoadState,
  Filter,
  AgentConversationDrafts,
  PendingAgentText,
  InboxRealtimeEvent,
  ThreadRealtimeEvent,
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
  message,
} from './dashboard-runtime';
import {
  AgentLogin,
  Startup,
  ConversationExpiryCountdown,
  Bubble,
} from './dashboard-ui';
import { AgentStatisticsModal } from './AgentStatisticsWorkspace';
import { AgentInboxPane, AgentSidebar } from './AgentWorkspacePanels';
import { AgentComposerAttachmentMenu } from './AgentAttachmentTools';
import {
  sendAgentPresetAttachments,
  type AgentAttachmentPreset,
  type AgentMessageAttachment,
} from './agent-attachments-client';
import { sendAgentImage } from './agent-media';
import {
  disableAgentNotifications,
  enableAgentNotifications,
  prepareAgentNotifications,
  type AgentNotificationState,
} from './agent-push';
import { UiIcon } from './icons';

type QuickAttachmentPreset = Extract<
  AgentAttachmentPreset,
  { kind: 'phone' | 'link' }
>;

type ThreadRealtimeWithAttachments = ThreadRealtimeEvent & {
  attachments?: unknown[];
};

function normalizeAgentMessageAttachment(
  value: unknown,
  messageIdFallback: string | null = null,
): AgentMessageAttachment | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const kind = raw.kind;
  const messageId =
    typeof raw.messageId === 'string' ? raw.messageId : messageIdFallback ?? undefined;
  if (!id || (kind !== 'phone' && kind !== 'link' && kind !== 'image')) {
    return null;
  }
  const label =
    typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim()
      : kind === 'image'
        ? typeof raw.originalName === 'string' && raw.originalName
          ? raw.originalName
          : '图片'
        : '';

  if (kind === 'phone' || kind === 'link') {
    if (typeof raw.value !== 'string' || !raw.value) return null;
    return {
      id,
      messageId,
      kind,
      label,
      value: raw.value,
    };
  }

  const mimeType = typeof raw.mimeType === 'string' ? raw.mimeType : '';
  const byteSize = Number(raw.byteSize);
  if (!mimeType || !Number.isFinite(byteSize)) return null;
  const source = raw.source === 'snapshot' ? 'snapshot' : 'media';
  const url =
    typeof raw.url === 'string' && raw.url
      ? raw.url
      : source === 'snapshot'
        ? `/api/agent/attachments/${encodeURIComponent(id)}/content`
        : `/api/agent/media/${encodeURIComponent(id)}/content`;
  return {
    id,
    messageId,
    kind: 'image',
    label,
    value: null,
    mimeType,
    byteSize,
    width: typeof raw.width === 'number' ? raw.width : null,
    height: typeof raw.height === 'number' ? raw.height : null,
    originalName:
      typeof raw.originalName === 'string' ? raw.originalName : null,
    source,
    url,
  };
}

function mergeMessageAttachments(
  current: AgentMessageAttachment[],
  incoming: AgentMessageAttachment[],
): AgentMessageAttachment[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) merged.set(item.id, item);
  return [...merged.values()];
}

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

  return (
    <AgentWorkspace
      identity={identity}
      onIdentityChange={setIdentity}
      onLogout={onLogout}
    />
  );
}

function AgentWorkspace({
  identity,
  onIdentityChange,
  onLogout,
}: {
  identity: AgentIdentity;
  onIdentityChange: (identity: AgentIdentity) => void;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messageAttachments, setMessageAttachments] = useState<
    AgentMessageAttachment[]
  >([]);
  const [attachmentSending, setAttachmentSending] = useState(false);
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
    void prepareAgentNotifications(identity.id)
      .then((state) => {
        if (active) setNotificationState(state);
      })
      .catch(() => {
        if (active) setNotificationState('disabled');
      });
    return () => {
      active = false;
    };
  }, [identity.id]);

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
      if (selectedId && (unreadCountRef.current.get(selectedId) ?? 0) > 0) {
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
        const isNewAssignment =
          belongsToAgent && !unreadCountRef.current.has(next.id);
        const previousUnread = unreadCountRef.current.get(next.id) ?? 0;
        if (belongsToAgent) {
          unreadCountRef.current.set(next.id, next.agent_unread_count);
        } else {
          unreadCountRef.current.delete(next.id);
        }
        if (
          belongsToAgent &&
          (isNewAssignment || next.agent_unread_count > previousUnread) &&
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
      setMessageAttachments([]);
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
            const incomingAttachments = (value.media as unknown[])
              .map((item) => normalizeAgentMessageAttachment(item))
              .filter(
                (item): item is AgentMessageAttachment => Boolean(item),
              );
            setMessageAttachments((currentAttachments) => {
              if (!incremental) return incomingAttachments;
              return mergeMessageAttachments(
                currentAttachments,
                incomingAttachments,
              );
            });
            if (
              document.visibilityState === 'visible' &&
              Number(value.conversation.agent_unread_count ?? 0) > 0
            ) {
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
        const payload = parseRealtimeEvent<ThreadRealtimeWithAttachments>(event);
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

          const realtimeAttachments = [
            ...(Array.isArray(payload.attachments) ? payload.attachments : []),
            ...(payload.media ? [payload.media] : []),
          ]
            .map((item) => normalizeAgentMessageAttachment(item, incoming.id))
            .filter(
              (item): item is AgentMessageAttachment => Boolean(item),
            );
          if (realtimeAttachments.length > 0) {
            setMessageAttachments((current) =>
              mergeMessageAttachments(current, realtimeAttachments),
            );
          }
          const preview = incoming.body || realtimeAttachments[0]?.label || '';
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
                last_message: preview,
                last_message_at: incoming.created_at,
              },
              messages: exists
                ? current.messages.map((item) =>
                    item.id === incoming.id ? incoming : item,
                  )
                : [...current.messages, incoming],
            };
          });
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
    setAttachmentSending(false);
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
      setMessageAttachments([]);
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
    attachmentSending,
    currentPendingText?.clientMessageId,
    currentPendingText?.status,
    lastMessageId,
    messageAttachments.length,
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
    if (
      !selectedId ||
      !draft.trim() ||
      currentPendingText ||
      attachmentSending
    )
      return;
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

  async function submitPresetAttachment(preset: QuickAttachmentPreset) {
    if (
      !selectedId ||
      attachmentSending ||
      currentPendingText ||
      !networkOnline ||
      !threadConnected ||
      detail?.conversation.status === 'closed'
    )
      return;
    setAttachmentSending(true);
    setError('');
    sendAgentTyping(false);
    const body = draft.trim();
    const clientMessageId = crypto.randomUUID();
    try {
      const sent = await sendAgentPresetAttachments(selectedId, {
        body,
        presetIds: [preset.id],
        clientMessageId,
      });
      const attachments = sent.attachments
        .map((item) => normalizeAgentMessageAttachment(item, sent.message.id))
        .filter((item): item is AgentMessageAttachment => Boolean(item));
      setMessageAttachments((current) =>
        mergeMessageAttachments(current, attachments),
      );
      setDetail((current) => {
        if (!current || current.conversation.id !== selectedId) return current;
        const exists = current.messages.some((item) => item.id === sent.message.id);
        return {
          ...current,
          conversation: {
            ...current.conversation,
            last_message: sent.message.body || preset.label,
            last_message_at: sent.message.created_at,
          },
          messages: exists
            ? current.messages.map((item) =>
                item.id === sent.message.id ? sent.message : item,
              )
            : [...current.messages, sent.message],
        };
      });
      if (body) updateDraft('');
    } catch (reason) {
      setError(message(reason, '附件发送失败'));
    } finally {
      setAttachmentSending(false);
    }
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
      const sentMessage: Message = {
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
      const attachment = normalizeAgentMessageAttachment(
        {
          ...sent.media,
          source: 'media',
          label: sent.media.originalName || '图片',
        },
        sent.messageId,
      );
      setDetail((current) => {
        if (!current || current.conversation.id !== selectedId) return current;
        const exists = current.messages.some((item) => item.id === sentMessage.id);
        return {
          ...current,
          conversation: {
            ...current.conversation,
            last_message: attachment?.label || '图片',
            last_message_at: sent.createdAt,
          },
          messages: exists ? current.messages : [...current.messages, sentMessage],
        };
      });
      if (attachment) {
        setMessageAttachments((current) =>
          mergeMessageAttachments(current, [attachment]),
        );
      }
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
    if (notificationState === 'install-required') {
      setError(
        'iPhone 或 iPad 需要先添加到主屏幕，再从桌面打开客服坐席并开启通知',
      );
      return;
    }
    if (notificationState === 'blocked') {
      setError('浏览器已阻止通知，请在站点权限中重新开启');
      return;
    }
    setNotificationBusy(true);
    try {
      const nextState =
        notificationState === 'enabled'
          ? await disableAgentNotifications()
          : await enableAgentNotifications(identity.id);
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

  return (
    <div className={`workspace-shell${selectedId ? ' is-thread-open' : ''}`}>
      <AgentSidebar
        identity={identity}
        availability={availability}
        notificationState={notificationState}
        notificationBusy={notificationBusy}
        soundEnabled={soundEnabled}
        onNicknameChange={async (nickname) => {
          const updated = await updateAgentNickname(nickname);
          onIdentityChange(updated);
        }}
        onToggleNotifications={() => void toggleNotifications()}
        onToggleSound={toggleSound}
        onOpenStatistics={() => setStatisticsOpen(true)}
        onLogout={() => void logoutFromWorkspace()}
      />

      <AgentInboxPane
        filter={filter}
        searchQuery={searchQuery}
        unreadFirst={unreadFirst}
        availability={availability}
        availabilitySaving={availabilitySaving}
        networkOnline={networkOnline}
        inboxConnected={inboxConnected}
        connectionState={connectionState}
        totalUnread={totalUnread}
        overview={overview}
        busy={busy}
        visibleConversations={visibleConversations}
        conversationCount={conversations.length}
        selectedId={selectedId}
        onFilterChange={setFilter}
        onSearchChange={setSearchQuery}
        onToggleUnreadFirst={() => setUnreadFirst((current) => !current)}
        onToggleAvailability={() => void toggleAvailability()}
        onSelectConversation={setSelectedId}
      />

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
            <strong>选择一个会话开始处理</strong>
            <span>新咨询分配给你后会出现在左侧列表。</span>
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
                <UiIcon name="back" />
              </button>
              <div className="thread-head-copy">
                <span className="thread-head-avatar" aria-hidden="true">
                  <UiIcon name="user" />
                </span>
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
                <span
                  className={`thread-status is-${detail.conversation.status}`}
                  aria-label="当前会话状态"
                >
                  {detail.conversation.status === 'open'
                    ? '新会话'
                    : detail.conversation.status === 'pending'
                      ? '处理中'
                      : '已关闭'}
                </span>
                <button
                  type="button"
                  className={`thread-status-action is-${detail.conversation.status}`}
                  onClick={() =>
                    void changeStatus(
                      detail.conversation.status === 'open'
                        ? 'pending'
                        : detail.conversation.status === 'pending'
                          ? 'closed'
                          : 'pending',
                    )
                  }
                >
                  {detail.conversation.status === 'open'
                    ? '开始处理'
                    : detail.conversation.status === 'pending'
                      ? '结束会话'
                      : '重新处理'}
                </button>
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
                    查看商品
                    <UiIcon name="external" />
                  </a>
                )}
              </div>
            )}
            <div className="messages" ref={messagesRef}>
              {(detail.messages as Message[]).map((item) => (
                <Bubble
                  key={item.id}
                  message={item}
                  attachments={messageAttachments.filter(
                    (attachment) => attachment.messageId === item.id,
                  )}
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
                <AgentComposerAttachmentMenu
                  disabled={
                    detail.conversation.status === 'closed' ||
                    mediaProgress !== null ||
                    attachmentSending ||
                    Boolean(currentPendingText) ||
                    !networkOnline ||
                    !threadConnected
                  }
                  onSendImage={(file) => void submitImage(file)}
                  onSendPreset={(preset) => void submitPresetAttachment(preset)}
                />
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
                      : attachmentSending
                        ? '附件发送中…'
                        : 'Enter 发送 · Shift + Enter 换行'}
                </span>
                <Button
                  aria-label="发送"
                  disabled={
                    Boolean(currentPendingText) ||
                    attachmentSending ||
                    !draft.trim() ||
                    detail.conversation.status === 'closed' ||
                    !networkOnline ||
                    !threadConnected
                  }
                >
                  <UiIcon name="send" />
                  <span>发送</span>
                </Button>
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
