import { readFile, writeFile } from 'node:fs/promises';

function requireIndex(source, marker, from = 0) {
  const index = source.indexOf(marker, from);
  if (index < 0) throw new Error(`Missing marker: ${marker}`);
  return index;
}

let admin = await readFile('src/dashboard/AdminPortal.tsx', 'utf8');
admin = admin.replace(
  "import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';",
  "import { FormEvent, useCallback, useEffect, useState } from 'react';",
);
admin = admin.replace('  initials,\n', '');
admin = admin.replace("import { ProductAssignmentPicker } from './ProductAssignmentPicker';\n", '');
admin = admin.replace("import { calendarMonthPeriod } from '../shared/calendar-month';\n", '');
admin = admin.replace(
  "import { UiIcon, AdminLogin, AdminSetup, Startup } from './dashboard-ui';\n",
  "import { UiIcon, AdminLogin, AdminSetup, Startup } from './dashboard-ui';\nimport { AdminStatisticsModal } from './AdminStatisticsModal';\nimport { AgentEditorModal } from './AgentEditorModal';\n",
);

const statsStart = requireIndex(admin, '      {statisticsOpen && (');
const editorStart = requireIndex(admin, '      {editorOpen && (', statsStart);
admin =
  admin.slice(0, statsStart) +
  `      {statisticsOpen && (\n        <AdminStatisticsModal\n          agents={agents}\n          month={statsMonth}\n          stats={monthlyStats}\n          busy={statsBusy}\n          error={statsError}\n          onClearError={() => setStatsError('')}\n          onMonthChange={(month) => {\n            setStatsBusy(true);\n            setStatsMonth(month);\n          }}\n          onClose={() => setStatisticsOpen(false)}\n        />\n      )}\n\n` +
  admin.slice(editorStart);

const nextEditorStart = requireIndex(admin, '      {editorOpen && (', statsStart);
const adminCenterClose = requireIndex(
  admin,
  '\n    </div>\n  );\n}\n\nfunction MonthlyAgentStatistics',
  nextEditorStart,
);
admin =
  admin.slice(0, nextEditorStart) +
  `      {editorOpen && (\n        <AgentEditorModal\n          draft={draft}\n          products={products}\n          saving={saving}\n          quotaAdjustments={quotaAdjustments}\n          quotaHistoryBusy={quotaHistoryBusy}\n          onDraftChange={setDraft}\n          onClose={() => {\n            if (!saving) setEditorOpen(false);\n          }}\n          onSubmit={(event) => void saveAgent(event)}\n        />\n      )}\n` +
  admin.slice(adminCenterClose);

const monthlyStart = requireIndex(admin, '\nfunction MonthlyAgentStatistics(');
const businessMonthStart = requireIndex(admin, '\nfunction currentBusinessMonth()', monthlyStart);
admin = admin.slice(0, monthlyStart) + admin.slice(businessMonthStart);
await writeFile('src/dashboard/AdminPortal.tsx', admin);

let agent = await readFile('src/dashboard/AgentPortal.tsx', 'utf8');
agent = agent.replace('  filterLabels,\n', '');
agent = agent.replace('  initials,\n', '');
agent = agent.replace('  relativeTime,\n', '');
agent = agent.replace(
  "import {\n  UiIcon,\n  AgentLogin,\n  Startup,\n  Metric,\n  ConversationExpiryCountdown,\n  Bubble,\n} from './dashboard-ui';\n",
  "import { AgentLogin, Startup, ConversationExpiryCountdown, Bubble } from './dashboard-ui';\n",
);
agent = agent.replace(
  "import { AgentStatisticsModal } from './AgentStatisticsWorkspace';\n",
  "import { AgentStatisticsModal } from './AgentStatisticsWorkspace';\nimport { AgentInboxPane, AgentSidebar } from './AgentWorkspacePanels';\n",
);

const sidebarStart = requireIndex(agent, '      <aside className="workspace-sidebar">');
const conversationStart = requireIndex(
  agent,
  '      <section className="conversation-pane">',
  sidebarStart,
);
agent =
  agent.slice(0, sidebarStart) +
  `      <AgentSidebar\n        identity={identity}\n        availability={availability}\n        notificationState={notificationState}\n        notificationBusy={notificationBusy}\n        soundEnabled={soundEnabled}\n        onToggleNotifications={() => void toggleNotifications()}\n        onToggleSound={toggleSound}\n        onOpenStatistics={() => setStatisticsOpen(true)}\n        onLogout={() => void logoutFromWorkspace()}\n      />\n\n` +
  agent.slice(conversationStart);

const nextConversationStart = requireIndex(
  agent,
  '      <section className="conversation-pane">',
  sidebarStart,
);
const threadStart = requireIndex(agent, '      <main className="thread-pane">', nextConversationStart);
agent =
  agent.slice(0, nextConversationStart) +
  `      <AgentInboxPane\n        filter={filter}\n        searchQuery={searchQuery}\n        unreadFirst={unreadFirst}\n        availability={availability}\n        availabilitySaving={availabilitySaving}\n        networkOnline={networkOnline}\n        inboxConnected={inboxConnected}\n        connectionState={connectionState}\n        totalUnread={totalUnread}\n        overview={overview}\n        busy={busy}\n        visibleConversations={visibleConversations}\n        conversationCount={conversations.length}\n        selectedId={selectedId}\n        onFilterChange={setFilter}\n        onSearchChange={setSearchQuery}\n        onToggleUnreadFirst={() => setUnreadFirst((current) => !current)}\n        onToggleAvailability={() => void toggleAvailability()}\n        onSelectConversation={setSelectedId}\n      />\n\n` +
  agent.slice(threadStart);
await writeFile('src/dashboard/AgentPortal.tsx', agent);
