import { readFile, unlink, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const sharedPath = new URL('src/dashboard/dashboard-shared.tsx', root);
const adminPath = new URL('src/dashboard/AdminPortal.tsx', root);
const agentPath = new URL('src/dashboard/AgentPortal.tsx', root);

const shared = await readFile(sharedPath, 'utf8');
const markers = {
  runtimeStart: "type LoadState = 'loading' | 'signed-out' | 'authenticated' | 'not-configured';",
  iconStart: 'type UiIconName =',
  draftStart: 'type AgentDraft =',
  authStart: 'function AdminLogin({',
  utilityStart: 'function presenceClass(',
  exportsStart: 'export type {',
};
for (const [name, marker] of Object.entries(markers)) {
  if (!shared.includes(marker)) throw new Error(`Missing ${name} marker: ${marker}`);
}

const runtimeStart = shared.indexOf(markers.runtimeStart);
const iconStart = shared.indexOf(markers.iconStart);
const draftStart = shared.indexOf(markers.draftStart);
const authStart = shared.indexOf(markers.authStart);
const utilityStart = shared.indexOf(markers.utilityStart);
const exportsStart = shared.indexOf(markers.exportsStart);
if (!(runtimeStart < iconStart && iconStart < draftStart && draftStart < authStart && authStart < utilityStart && utilityStart < exportsStart)) {
  throw new Error('Unexpected dashboard-shared section ordering');
}

const runtimeBody = [
  shared.slice(runtimeStart, iconStart).trim(),
  shared.slice(draftStart, authStart).trim(),
  shared.slice(utilityStart, exportsStart).trim(),
].join('\n\n');
const uiBody = [
  shared.slice(iconStart, draftStart).trim(),
  shared.slice(authStart, utilityStart).trim(),
].join('\n\n');

const runtimeSource = `import type {
  AgentAccount,
  AgentRoutingScope,
  Conversation,
  Message,
  Overview,
  ProductCatalogItem,
} from './api';

${runtimeBody}

export type {
  LoadState,
  Filter,
  AdminSection,
  AgentDraft,
  AgentConversationDrafts,
  PendingAgentText,
  InboxRealtimeEvent,
  ThreadRealtimeEvent,
};

export {
  emptyAgentDraft,
  filterLabels,
  CHAT_TIME_ZONE,
  AGENT_TYPING_IDLE_MS,
  REMOTE_TYPING_STALE_MS,
  loadAgentConversationDrafts,
  saveAgentConversationDrafts,
  loadAgentSoundEnabled,
  saveAgentSoundEnabled,
  emitAgentMessageTone,
  parseRealtimeEvent,
  sortedConversationList,
  compareMessages,
  productsForScope,
  agentScopeSummary,
  presenceClass,
  statusLabel,
  initials,
  relativeTime,
  formatTime,
  message,
};
`;

const uiSource = `import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Message } from './api';
import type { AgentMediaItem } from './agent-media';
import { formatTime } from './dashboard-runtime';

${uiBody}

export {
  UiIcon,
  AdminLogin,
  AgentLogin,
  AdminSetup,
  Startup,
  Metric,
  ConversationExpiryCountdown,
  Bubble,
};
`;

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing replacement target: ${label}`);
  return source.replace(before, after);
}

let admin = await readFile(adminPath, 'utf8');
const adminOldImport = `import {
  LoadState,
  AdminSection,
  AgentDraft,
  UiIcon,
  emptyAgentDraft,
  CHAT_TIME_ZONE,
  productsForScope,
  agentScopeSummary,
  AdminLogin,
  AdminSetup,
  Startup,
  presenceClass,
  statusLabel,
  initials,
  relativeTime,
  message,
} from './dashboard-shared';`;
const adminNewImport = `import {
  LoadState,
  AdminSection,
  AgentDraft,
  emptyAgentDraft,
  CHAT_TIME_ZONE,
  productsForScope,
  agentScopeSummary,
  presenceClass,
  statusLabel,
  initials,
  relativeTime,
  message,
} from './dashboard-runtime';
import { UiIcon, AdminLogin, AdminSetup, Startup } from './dashboard-ui';`;
admin = replaceRequired(admin, adminOldImport, adminNewImport, 'AdminPortal shared import');

let agent = await readFile(agentPath, 'utf8');
const agentOldImport = `import {
  LoadState,
  Filter,
  AgentConversationDrafts,
  PendingAgentText,
  InboxRealtimeEvent,
  ThreadRealtimeEvent,
  UiIcon,
  filterLabels,
  AGENT_TYPING_IDLE_MS,
  REMOTE_TYPING_STALE_MS,
  loadAgentConversationDrafts,
  saveAgentConversationDrafts,
  loadAgentSoundEnabled,
  saveAgentSoundEnabled,
  emitAgentMessageTone,
  parseRealtimeEvent,
  sortedConversationList,
  compareMessages,
  AgentLogin,
  Startup,
  Metric,
  ConversationExpiryCountdown,
  Bubble,
  initials,
  relativeTime,
  message,
} from './dashboard-shared';`;
const agentNewImport = `import {
  LoadState,
  Filter,
  AgentConversationDrafts,
  PendingAgentText,
  InboxRealtimeEvent,
  ThreadRealtimeEvent,
  filterLabels,
  AGENT_TYPING_IDLE_MS,
  REMOTE_TYPING_STALE_MS,
  loadAgentConversationDrafts,
  saveAgentConversationDrafts,
  loadAgentSoundEnabled,
  saveAgentSoundEnabled,
  emitAgentMessageTone,
  parseRealtimeEvent,
  sortedConversationList,
  compareMessages,
  initials,
  relativeTime,
  message,
} from './dashboard-runtime';
import {
  UiIcon,
  AgentLogin,
  Startup,
  Metric,
  ConversationExpiryCountdown,
  Bubble,
} from './dashboard-ui';`;
agent = replaceRequired(agent, agentOldImport, agentNewImport, 'AgentPortal shared import');

const testRewrites = new Map([
  ['test/admin-scope-ui-contract.test.mjs', (source) => {
    source = replaceRequired(source, "  const app = source('../src/dashboard/App.tsx');", "  const admin = source('../src/dashboard/AdminPortal.tsx');\n  const runtime = source('../src/dashboard/dashboard-runtime.ts');", 'admin scope sources');
    for (const token of ['<th>负责范围</th>', 'agentScopeSummary(', '<th>负责产品</th>', 'aria-modal="true"', '再配置它的分流负责范围', '分配负责产品']) {
      source = source.replaceAll(`app.includes('${token.replaceAll("'", "\\'")}')`, `admin.includes('${token.replaceAll("'", "\\'")}')`);
    }
    source = source.replaceAll("app.includes('整个分区')", "runtime.includes('整个分区')");
    source = source.replaceAll("app.includes('动态覆盖')", "runtime.includes('动态覆盖')");
    return source;
  }],
  ['test/agent-connection-reliability.test.mjs', (source) => source.replaceAll("read('../src/dashboard/App.tsx')", "read('../src/dashboard/AgentPortal.tsx')")],
  ['test/agent-inbox-optimization.test.mjs', (source) => source.replaceAll("read('../src/dashboard/App.tsx')", "read('../src/dashboard/AgentPortal.tsx')")],
  ['test/agent-mobile-layout-contract.test.mjs', (source) => source.replaceAll("source('../src/dashboard/App.tsx')", "source('../src/dashboard/AgentPortal.tsx')")],
  ['test/agent-reception-efficiency.test.mjs', (source) => {
    source = replaceRequired(source, "  const app = source('../src/dashboard/App.tsx');", "  const agent = source('../src/dashboard/AgentPortal.tsx');\n  const runtime = source('../src/dashboard/dashboard-runtime.ts');", 'reception efficiency sources');
    source = source.replaceAll("app.includes('cs-agent-sound:${agentId}')", "runtime.includes('cs-agent-sound:${agentId}')");
    source = source.replaceAll("app.includes('emitAgentMessageTone')", "runtime.includes('emitAgentMessageTone')");
    source = source.replaceAll('app.includes(', 'agent.includes(');
    return source;
  }],
  ['test/agent-reception-reliability.test.mjs', (source) => {
    source = source.replace("read('../src/dashboard/App.tsx'),\n  ]);\n\n  assert.match(agentApi, /\\/api\\/agent\\/auth\\/status/u);", "read('../src/dashboard/AgentPortal.tsx'),\n  ]);\n\n  assert.match(agentApi, /\\/api\\/agent\\/auth\\/status/u);");
    source = replaceRequired(source, "  const [agentApi, dashboardApi, dashboard] = await Promise.all([\n    read('../src/worker/agent-api.ts'),\n    read('../src/dashboard/api.ts'),\n    read('../src/dashboard/App.tsx'),\n  ]);", "  const [agentApi, dashboardApi, dashboard, runtime] = await Promise.all([\n    read('../src/worker/agent-api.ts'),\n    read('../src/dashboard/api.ts'),\n    read('../src/dashboard/AgentPortal.tsx'),\n    read('../src/dashboard/dashboard-runtime.ts'),\n  ]);", 'reception reliability sources');
    source = source.replace('assert.match(dashboard, /cs-agent-drafts:/u);', 'assert.match(runtime, /cs-agent-drafts:/u);');
    source = source.replace('assert.match(dashboard, /AGENT_DRAFT_TTL_MS/u);', 'assert.match(runtime, /AGENT_DRAFT_TTL_MS/u);');
    return source;
  }],
  ['test/agent-statistics-modal.test.mjs', (source) => source
    .replace("const app = source('../src/dashboard/App.tsx');", "const app = source('../src/dashboard/AgentPortal.tsx');")
    .replace("const app = source('../src/dashboard/App.tsx');", "const app = source('../src/dashboard/AdminPortal.tsx');")],
  ['test/agent-transfer-quick-replies.test.mjs', (source) => source.replaceAll("read('../src/dashboard/App.tsx')", "read('../src/dashboard/AgentPortal.tsx')")],
  ['test/realtime-contract.test.mjs', (source) => source.replace("new URL('../src/dashboard/App.tsx', import.meta.url)", "new URL('../src/dashboard/AgentPortal.tsx', import.meta.url)"))],
  ['test/scope-native-dashboard-contract.test.mjs', (source) => {
    source = replaceRequired(source, "  const app = source('../src/dashboard/App.tsx');", "  const admin = source('../src/dashboard/AdminPortal.tsx');\n  const runtime = source('../src/dashboard/dashboard-runtime.ts');", 'scope native sources');
    source = source.replace("assert.ok(app.includes('routingScope: AgentRoutingScope'));", "assert.ok(runtime.includes('routingScope: AgentRoutingScope'));");
    source = source.replaceAll('app.includes(', 'admin.includes(');
    return source;
  }],
]);

await Promise.all([
  writeFile(new URL('src/dashboard/dashboard-runtime.ts', root), runtimeSource),
  writeFile(new URL('src/dashboard/dashboard-ui.tsx', root), uiSource),
  writeFile(adminPath, admin),
  writeFile(agentPath, agent),
  ...[...testRewrites].map(async ([path, rewrite]) => {
    const url = new URL(path, root);
    const before = await readFile(url, 'utf8');
    const after = rewrite(before);
    if (after === before) throw new Error(`No test rewrite applied: ${path}`);
    await writeFile(url, after);
  }),
]);

await unlink(sharedPath);

// These helpers exist only to make the one-time large-file split deterministic.
await Promise.all([
  unlink(new URL('scripts/refactor-dashboard-app.mjs', root)),
  unlink(new URL('.github/workflows/refactor-dashboard-once.yml', root)),
]);

console.log('Finalized dashboard modules, contract test paths, and removed one-time helpers.');
