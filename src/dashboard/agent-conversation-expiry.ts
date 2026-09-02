import type { Conversation } from './api';

export function expiredConversationIds(
  conversations: Conversation[],
  now = Date.now(),
): Set<string> {
  return new Set(
    conversations
      .filter((conversation) => {
        if (!conversation.expires_at) return false;
        const expiresAt = Date.parse(conversation.expires_at);
        return Number.isFinite(expiresAt) && expiresAt <= now;
      })
      .map((conversation) => conversation.id),
  );
}

export function nextConversationExpiryAt(
  conversations: Conversation[],
  now = Date.now(),
): number | null {
  let next: number | null = null;
  for (const conversation of conversations) {
    if (!conversation.expires_at) continue;
    const expiresAt = Date.parse(conversation.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
    next = next === null ? expiresAt : Math.min(next, expiresAt);
  }
  return next;
}
