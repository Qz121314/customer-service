from pathlib import Path

path = Path("src/worker/agent-api.ts")
text = path.read_text()
old = """    broadcastClientConversationEvent(c.env, id, 'conversation.assigned'),
"""
new = """    broadcastClientConversationEvent(c.env, id, 'conversation.assigned').then(
      () => undefined,
    ),
"""
if text.count(old) != 1:
    raise SystemExit(f"agent-api.ts: transfer broadcaster call mismatch ({text.count(old)})")
path.write_text(text.replace(old, new, 1))
