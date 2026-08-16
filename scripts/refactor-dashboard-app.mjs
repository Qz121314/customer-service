import { readFile, writeFile } from 'node:fs/promises';

const appPath = new URL('../src/dashboard/App.tsx', import.meta.url);
const source = await readFile(appPath, 'utf8');

const markers = {
  sharedStart: "type LoadState = 'loading' | 'signed-out' | 'authenticated' | 'not-configured';",
  appStart: 'export function App() {',
  adminStart: 'function AdminPortal() {',
  agentStart: 'function AgentPortal() {',
  sharedBottomStart: 'function AdminLogin({',
};

for (const [name, marker] of Object.entries(markers)) {
  if (!source.includes(marker)) throw new Error(`Missing ${name} marker: ${marker}`);
}

const sharedStart = source.indexOf(markers.sharedStart);
const appStart = source.indexOf(markers.appStart);
const adminStart = source.indexOf(markers.adminStart);
const agentStart = source.indexOf(markers.agentStart);
const sharedBottomStart = source.indexOf(markers.sharedBottomStart);

if (!(sharedStart < appStart && appStart < adminStart && adminStart < agentStart && agentStart < sharedBottomStart)) {
  throw new Error('Unexpected App.tsx section ordering');
}

const sharedTop = source.slice(sharedStart, appStart).trimEnd();
const adminBlock = source.slice(adminStart, agentStart).trimEnd();
const agentBlock = source.slice(agentStart, sharedBottomStart).trimEnd();
const sharedBottom = source.slice(sharedBottomStart).trimEnd();

const sharedSource = `${`import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type {
  AgentAccount,
  AgentRoutingScope,
  Conversation,
  Message,
  Overview,
  ProductCatalogItem,
} from './api';
import type { AgentMediaItem } from './agent-media';

`}${sharedTop.replaceAll('React.ReactNode', 'ReactNode')}

${sharedBottom.replaceAll('React.ReactNode', 'ReactNode')}

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
  UiIcon,
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
  AdminLogin,
  AgentLogin,
  AdminSetup,
  Startup,
  Metric,
  ConversationExpiryCountdown,
  Bubble,
  presenceClass,
  statusLabel,
  initials,
  relativeTime,
  formatTime,
  message,
};
`;

const apiNames = [
  'AgentAccount',
  'AgentAvailability',
  'AgentInbox',
  'AgentQuotaAdjustment',
  'AgentRoutingScope',
  'AgentMonthlyStats',
  'ProductCatalogItem',
  'AgentIdentity',
  'Conversation',
  'ConversationDetail',
  'Message',
  'Overview',
  'QuickReply',
  'TransferTarget',
  'adminLogin',
  'adminLogout',
  'agentLogin',
  'agentLogout',
  'createAgent',
  'createQuickReply',
  'deleteQuickReply',
  'getAdminSession',
  'getAgentMonthlyStats',
  'getAgentQuotaAdjustments',
  'getAgentInbox',
  'getAgentSession',
  'getAgents',
  'getConversation',
  'getProductCatalog',
  'heartbeat',
  'markConversationRead',
  'openAgentInboxSocket',
  'openConversationSocket',
  'realtimeReconnectDelay',
  'sendMessage',
  'setAgentAvailability',
  'setConversationStatus',
  'transferConversation',
  'updateAgent',
];

const sharedNames = [
  'LoadState',
  'Filter',
  'AdminSection',
  'AgentDraft',
  'AgentConversationDrafts',
  'PendingAgentText',
  'InboxRealtimeEvent',
  'ThreadRealtimeEvent',
  'UiIcon',
  'emptyAgentDraft',
  'filterLabels',
  'CHAT_TIME_ZONE',
  'AGENT_TYPING_IDLE_MS',
  'REMOTE_TYPING_STALE_MS',
  'loadAgentConversationDrafts',
  'saveAgentConversationDrafts',
  'loadAgentSoundEnabled',
  'saveAgentSoundEnabled',
  'emitAgentMessageTone',
  'parseRealtimeEvent',
  'sortedConversationList',
  'compareMessages',
  'productsForScope',
  'agentScopeSummary',
  'AdminLogin',
  'AgentLogin',
  'AdminSetup',
  'Startup',
  'Metric',
  'ConversationExpiryCountdown',
  'Bubble',
  'presenceClass',
  'statusLabel',
  'initials',
  'relativeTime',
  'formatTime',
  'message',
];

const reactNames = [
  'FormEvent',
  'useCallback',
  'useEffect',
  'useLayoutEffect',
  'useMemo',
  'useRef',
  'useState',
];

function namesUsed(block, names) {
  return names.filter((name) => new RegExp(`\\b${name}\\b`).test(block));
}

function namedImport(names, from) {
  if (!names.length) return '';
  return `import {\n${names.map((name) => `  ${name},`).join('\n')}\n} from '${from}';\n`;
}

function moduleHeader(block, kind) {
  const react = namesUsed(block, reactNames);
  const api = namesUsed(block, apiNames);
  const shared = namesUsed(block, sharedNames);
  let header = namedImport(react, 'react');
  header += namedImport(api, './api');
  header += namedImport(shared, './dashboard-shared');

  if (kind === 'admin') {
    header += "import { ProductAssignmentPicker } from './ProductAssignmentPicker';\n";
    header += "import { calendarMonthPeriod } from '../shared/calendar-month';\n";
  } else {
    header += "import { AgentStatisticsModal } from './AgentStatisticsWorkspace';\n";
    header += "import { sendAgentImage, type AgentMediaItem } from './agent-media';\n";
    header += `import {
  disableAgentNotifications,
  enableAgentNotifications,
  prepareAgentNotifications,
  type AgentNotificationState,
} from './agent-push';
`;
  }
  return `${header}\n`;
}

const adminSource = `${moduleHeader(adminBlock, 'admin')}${adminBlock.replace('function AdminPortal() {', 'export function AdminPortal() {')}\n`;
const agentSource = `${moduleHeader(agentBlock, 'agent')}${agentBlock
  .replace('function AgentPortal() {', 'export function AgentPortal() {')
  .replaceAll('React.CSSProperties', 'CSSProperties')}\n`;

const agentWithCssImport = agentSource.includes('CSSProperties')
  ? agentSource.replace(
      "import {\n  FormEvent,",
      "import {\n  type CSSProperties,\n  FormEvent,",
    )
  : agentSource;

const appSource = `import { AdminPortal } from './AdminPortal';
import { AgentPortal } from './AgentPortal';

export function App() {
  return window.location.pathname.startsWith('/agent') ? (
    <AgentPortal />
  ) : (
    <AdminPortal />
  );
}
`;

await Promise.all([
  writeFile(new URL('../src/dashboard/dashboard-shared.tsx', import.meta.url), sharedSource),
  writeFile(new URL('../src/dashboard/AdminPortal.tsx', import.meta.url), adminSource),
  writeFile(new URL('../src/dashboard/AgentPortal.tsx', import.meta.url), agentWithCssImport),
  writeFile(appPath, appSource),
]);

console.log('Split dashboard App.tsx into App, AdminPortal, AgentPortal, and dashboard-shared.');
