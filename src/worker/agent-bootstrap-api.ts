import { Hono } from 'hono';
import { authenticateAgentSession, publicAgentSession } from './agent-session';
import { loadAgentInbox } from './agent-inbox';

type Bindings = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

type Env = { Bindings: Bindings };

export const agentBootstrapApi = new Hono<Env>();

// Initial dashboard hydration uses one external Worker request and one session
// lookup. Bootstrap and normal refresh share the same inbox loader so closed
// preview, overview and quota semantics have one runtime source of truth.
agentBootstrapApi.get('/api/agent/bootstrap', async (c) => {
  const agent = await authenticateAgentSession(
    c.env.DB,
    c.req.header('Cookie'),
  );
  if (!agent) {
    return c.json({ authenticated: false, agent: null, inbox: null });
  }

  return c.json({
    authenticated: true,
    agent: publicAgentSession(agent),
    inbox: await loadAgentInbox(c.env.DB, agent),
  });
});
