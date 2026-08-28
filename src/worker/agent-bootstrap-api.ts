import { Hono, type Context } from 'hono';
import { agentApi } from './agent-api';

type Bindings = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

type Env = { Bindings: Bindings };

type AgentSessionPayload = {
  authenticated: boolean;
  agent: Record<string, unknown> | null;
};

export const agentBootstrapApi = new Hono<Env>();

// Keep the existing agent session and inbox handlers as the source of truth,
// while collapsing the dashboard's initial two external Worker requests into
// one. Signed-out visitors stop after the session check, so they do not pay for
// an unnecessary inbox lookup.
agentBootstrapApi.get('/api/agent/bootstrap', async (c) => {
  const sessionResponse = await forwardAgentGet(c, '/api/agent/auth/session');
  if (!sessionResponse.ok) return sessionResponse;

  const session = (await sessionResponse.json()) as AgentSessionPayload;
  if (!session.authenticated || !session.agent) {
    return c.json({ ...session, inbox: null });
  }

  const inboxResponse = await forwardAgentGet(c, '/api/agent/conversations');
  if (!inboxResponse.ok) return inboxResponse;

  return c.json({
    ...session,
    inbox: await inboxResponse.json(),
  });
});

function forwardAgentGet(c: Context<Env>, pathname: string): Promise<Response> {
  const url = new URL(c.req.url);
  url.pathname = pathname;
  url.search = '';
  return agentApi.fetch(
    new Request(url, {
      method: 'GET',
      headers: c.req.raw.headers,
    }),
    c.env,
    c.executionCtx,
  );
}
