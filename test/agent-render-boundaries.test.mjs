import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent workspace isolates inbox, thread messages, settings, and composer renders', () => {
  const portal = source('../src/dashboard/AgentPortal.tsx');
  const panels = source('../src/dashboard/AgentWorkspacePanels.tsx');

  for (const boundary of [
    'export const AgentSidebar = memo(function AgentSidebar',
    'export const AgentInboxPane = memo(function AgentInboxPane',
  ]) {
    assert.ok(panels.includes(boundary), boundary);
  }

  for (const boundary of [
    'const AgentThreadMessageTree = memo(function AgentThreadMessageTree',
    'const AgentComposer = memo(function AgentComposer',
    'const updateDraft = useCallback(',
    'const deliverTextMessage = useCallback(',
    'const submitPresetAttachment = useCallback(',
    'const submitImage = useCallback(',
    'const toggleAvailability = useCallback(',
    'const toggleNotifications = useCallback(',
    'const toggleSound = useCallback(',
    'const handleToggleUnreadFirst = useCallback(',
    '<AgentThreadMessageTree',
    '<AgentComposer',
  ]) {
    assert.ok(portal.includes(boundary), boundary);
  }

  for (const unstableProp of [
    'onToggleUnreadFirst={() =>',
    'onToggleAvailability={() =>',
    'onToggleNotifications={() =>',
    'onOpenStatistics={() =>',
  ]) {
    assert.equal(
      portal.includes(unstableProp),
      false,
      `memoized workspace panel must receive a stable callback: ${unstableProp}`,
    );
  }
});
