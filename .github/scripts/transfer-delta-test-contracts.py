from pathlib import Path

# The broadcaster now supports a previous agent inbox delta instead of requiring
# an early return when a conversation has no current assignee.
path = Path('test/agent-realtime-isolation.test.mjs')
text = path.read_text()
old = '''  assert.match(
    clientApi,
    /if \\(!conversation\\.assigned_agent\\) return conversation;/u,
  );
'''
new = '''  assert.match(
    clientApi,
    /broadcastRoom\\(env, agentInboxRoom\\(previousAgentId\\)/u,
  );
'''
assert text.count(old) == 1
path.write_text(text.replace(old, new, 1))

# The real end-to-end transfer should now receive incremental deltas rather than
# triggering a full inbox refresh for either the target or previous agent.
path = Path('test/customer-service-full-flow.test.mjs')
text = path.read_text()
old = '''  assert.ok(
    (rooms.events.get('agent-inbox:agent-transfer') ?? []).some(
      (event) => event.type === 'conversation.refresh',
    ),
  );
'''
new = '''  assert.ok(
    (rooms.events.get('agent-inbox:agent-transfer') ?? []).some(
      (event) => event.type === 'conversation.changed',
    ),
  );
  assert.ok(
    (rooms.events.get('agent-inbox:agent-standby') ?? []).some(
      (event) => event.type === 'conversation.changed',
    ),
  );
'''
assert text.count(old) == 1
path.write_text(text.replace(old, new, 1))

# Preserve the existing resource-cost contract while allowing the broadcaster
# to carry the previous agent id used only by transfer/requeue deltas.
path = Path('test/message-send-d1-cost.test.mjs')
text = path.read_text()
old = '''  assert.match(broadcaster, /options: \\{ includeOverview\\?: boolean \\}/u);
  assert.match(
    broadcaster,
    /type === 'conversation\\.assigned' \\|\\| type === 'conversation\\.closed'/u,
  );
  assert.match(broadcaster, /includeOverview\\s*\\? await loadAgentOverview/u);
'''
new = '''  assert.match(
    broadcaster,
    /options: \\{[\\s\\S]*includeOverview\\?: boolean;[\\s\\S]*previousAgentId\\?: string \\| null;[\\s\\S]*\\} = \\{\\}/u,
  );
  assert.match(
    broadcaster,
    /type === 'conversation\\.assigned' \\|\\| type === 'conversation\\.closed'/u,
  );
  assert.match(
    broadcaster,
    /conversation\\.assigned_agent && includeOverview[\\s\\S]*loadAgentOverview\\(env\\.DB, conversation\\.assigned_agent\\)/u,
  );
  assert.match(
    broadcaster,
    /previousAgentId[\\s\\S]*loadAgentOverview\\(env\\.DB, previousAgentId\\)/u,
  );
'''
assert text.count(old) == 1
path.write_text(text.replace(old, new, 1))
