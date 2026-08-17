import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, mutate) {
  const before = readFileSync(path, 'utf8');
  const after = mutate(before);
  if (after === before) throw new Error(`No changes applied to ${path}`);
  writeFileSync(path, after);
}

function replaceOnce(source, from, to, label) {
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(from, index + from.length) >= 0) {
    throw new Error(`Expected one ${label}`);
  }
  return source.slice(0, index) + to + source.slice(index + from.length);
}

patch('src/dashboard/AgentWorkspacePanels.tsx', (source) => {
  source = replaceOnce(
    source,
    "import { Metric, UiIcon } from './dashboard-ui';\n",
    "import { Metric, UiIcon } from './dashboard-ui';\nimport { AgentAvatarControl } from './AgentAvatarControl';\n",
    'AgentAvatarControl import anchor',
  );
  source = replaceOnce(
    source,
    '        <span className="avatar">{initials(identity.name)}</span>\n',
    '        <AgentAvatarControl agentId={identity.id} agentName={identity.name} />\n',
    'agent profile avatar',
  );
  return source;
});

patch('src/worker/client-api.ts', (source) => {
  source = replaceOnce(
    source,
    '  agent_name: string | null;\n',
    '  agent_name: string | null;\n  agent_avatar_version: string | null;\n',
    'ConversationRow avatar field',
  );

  const selectAnchor = 'a.name AS agent_name';
  const matches = source.split(selectAnchor).length - 1;
  if (matches < 3) throw new Error(`Expected at least 3 agent-name joins, got ${matches}`);
  source = source.replaceAll(
    selectAnchor,
    'a.name AS agent_name, a.avatar_version AS agent_avatar_version',
  );

  source = replaceOnce(
    source,
    '    agentAvatarUrl: null,\n',
    "    agentAvatarUrl:\n      conversation.assigned_agent && conversation.agent_avatar_version\n        ? `/client/v1/avatars/${encodeURIComponent(conversation.assigned_agent)}?v=${encodeURIComponent(conversation.agent_avatar_version)}`\n        : null,\n",
    'client avatar summary',
  );
  return source;
});
