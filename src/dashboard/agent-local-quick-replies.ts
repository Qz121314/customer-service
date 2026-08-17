export type LocalQuickReply = {
  id: string;
  title: string;
  body: string;
};

const QUICK_REPLY_LIMIT = 30;
const QUICK_REPLY_TITLE_LIMIT = 40;
const QUICK_REPLY_BODY_LIMIT = 1000;
const ACTIVE_AGENT_KEY = 'cs-agent-active-id';

let activeAgentId = readSessionAgentId();

export function setLocalQuickReplyAgent(agentId: string | null): void {
  activeAgentId = agentId;
  try {
    if (agentId) {
      window.sessionStorage.setItem(ACTIVE_AGENT_KEY, agentId);
    } else {
      window.sessionStorage.removeItem(ACTIVE_AGENT_KEY);
    }
  } catch {
    // Session identity is only a local storage namespace hint.
  }
}

export function listLocalQuickReplies(): LocalQuickReply[] {
  if (!activeAgentId) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(activeAgentId));
    if (!raw) return [];
    return sanitizeQuickReplies(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function createLocalQuickReply(input: {
  title: string;
  body: string;
}): LocalQuickReply {
  if (!activeAgentId) throw new Error('登录已失效，请重新登录');
  const title = normalizeText(input.title, QUICK_REPLY_TITLE_LIMIT);
  const body = normalizeText(input.body, QUICK_REPLY_BODY_LIMIT);
  if (!title || !body) throw new Error('快捷回复名称或内容无效');

  const current = listLocalQuickReplies();
  if (current.length >= QUICK_REPLY_LIMIT) {
    throw new Error('每个客服最多保存 30 条快捷回复');
  }

  const reply: LocalQuickReply = { id: crypto.randomUUID(), title, body };
  storeQuickReplies([reply, ...current]);
  return reply;
}

export function deleteLocalQuickReply(id: string): void {
  if (!activeAgentId) throw new Error('登录已失效，请重新登录');
  const current = listLocalQuickReplies();
  const next = current.filter((reply) => reply.id !== id);
  if (next.length !== current.length) storeQuickReplies(next);
}

function storeQuickReplies(replies: LocalQuickReply[]): void {
  if (!activeAgentId) return;
  try {
    const next = sanitizeQuickReplies(replies);
    const key = storageKey(activeAgentId);
    if (next.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Quick replies are local convenience data and must never block chat.
  }
}

function sanitizeQuickReplies(value: unknown): LocalQuickReply[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const replies: LocalQuickReply[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const row = candidate as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    const title = normalizeText(row.title, QUICK_REPLY_TITLE_LIMIT);
    const body = normalizeText(row.body, QUICK_REPLY_BODY_LIMIT);
    if (!id || !title || !body || seen.has(id)) continue;
    seen.add(id);
    replies.push({ id, title, body });
    if (replies.length >= QUICK_REPLY_LIMIT) break;
  }
  return replies;
}

function normalizeText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function storageKey(agentId: string): string {
  return `cs-agent-quick-replies:${agentId}`;
}

function readSessionAgentId(): string | null {
  try {
    return window.sessionStorage.getItem(ACTIVE_AGENT_KEY);
  } catch {
    return null;
  }
}
