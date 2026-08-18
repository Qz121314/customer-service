export type AgentInitialGreeting = {
  enabled: boolean;
  text: string;
};

export async function loadAgentInitialGreeting(): Promise<AgentInitialGreeting> {
  const response = await fetch('/api/agent/auto-replies', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('AUTO_REPLY_LOAD_FAILED');
  const value = (await response.json()) as {
    initialGreeting?: Partial<AgentInitialGreeting>;
  };
  return normalizeGreeting(value.initialGreeting);
}

export async function saveAgentInitialGreeting(
  value: AgentInitialGreeting,
): Promise<AgentInitialGreeting> {
  const response = await fetch('/api/agent/auto-replies/initial-greeting', {
    method: 'PUT',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error('AUTO_REPLY_SAVE_FAILED');
  const body = (await response.json()) as {
    initialGreeting?: Partial<AgentInitialGreeting>;
  };
  return normalizeGreeting(body.initialGreeting);
}

function normalizeGreeting(
  value: Partial<AgentInitialGreeting> | undefined,
): AgentInitialGreeting {
  const text = typeof value?.text === 'string' ? value.text : '';
  return {
    enabled: value?.enabled === true && Boolean(text.trim()),
    text,
  };
}
