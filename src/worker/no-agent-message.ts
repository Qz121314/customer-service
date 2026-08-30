export type NoAgentMessageFormat = 'plain' | 'markdown';

export const DEFAULT_NO_AGENT_MESSAGE = '当前暂无可用客服，请稍后再试。';
export const MAX_NO_AGENT_MESSAGE_LENGTH = 4000;

export function normalizeNoAgentMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const message = value.trim();
  return message && message.length <= MAX_NO_AGENT_MESSAGE_LENGTH
    ? message
    : null;
}

export function normalizeNoAgentMessageFormat(
  value: unknown,
): NoAgentMessageFormat | null {
  return value === 'plain' || value === 'markdown' ? value : null;
}
