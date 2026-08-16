from pathlib import Path

agent_path = Path("src/worker/agent-api.ts")
agent_text = agent_path.read_text()
old_agent = """    broadcastClientConversationEvent(c.env, id, 'conversation.assigned'),
"""
new_agent = """    broadcastClientConversationEvent(c.env, id, 'conversation.assigned').then(
      () => undefined,
    ),
"""
if agent_text.count(old_agent) != 1:
    raise SystemExit(
        f"agent-api.ts: transfer broadcaster call mismatch ({agent_text.count(old_agent)})"
    )
agent_path.write_text(agent_text.replace(old_agent, new_agent, 1))

routing_path = Path("src/worker/routing.ts")
routing_text = routing_path.read_text()
old_routing_start = """  const result = await db
"""
new_routing_start = """  const assignment = await db
"""
if routing_text.count(old_routing_start) != 1:
    raise SystemExit(
        f"routing.ts: assignment result start mismatch ({routing_text.count(old_routing_start)})"
    )
routing_text = routing_text.replace(old_routing_start, new_routing_start, 1)
old_routing_tail = """    .bind(conversationId, now, businessDate, excludedAgentId ?? '')
    .all<AgentAssignmentRow>();

  const assignment = result.results?.[0];
"""
new_routing_tail = """    .bind(conversationId, now, businessDate, excludedAgentId ?? '')
    .first<AgentAssignmentRow>();
"""
if routing_text.count(old_routing_tail) != 1:
    raise SystemExit(
        f"routing.ts: assignment RETURNING tail mismatch ({routing_text.count(old_routing_tail)})"
    )
routing_path.write_text(routing_text.replace(old_routing_tail, new_routing_tail, 1))

realtime_test_path = Path("test/agent-realtime-isolation.test.mjs")
realtime_test = realtime_test_path.read_text()
old_test = """  assert.match(clientApi, /if \\(!conversation\\.assigned_agent\\) return;/u);
"""
new_test = """  assert.match(
    clientApi,
    /if \\(!conversation\\.assigned_agent\\) return conversation;/u,
  );
"""
if realtime_test.count(old_test) != 1:
    raise SystemExit(
        f"agent-realtime-isolation.test.mjs: broadcaster contract mismatch ({realtime_test.count(old_test)})"
    )
realtime_test_path.write_text(realtime_test.replace(old_test, new_test, 1))
