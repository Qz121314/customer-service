import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent web push is authenticated, session-scoped and dispatched after visitor writes', async () => {
  const [
    api,
    delivery,
    entry,
    classification,
    migration,
    payloadMigration,
    dashboard,
    chrome,
  ] = await Promise.all([
    read('../src/worker/agent-push-api.ts'),
    read('../src/worker/agent-push.ts'),
    read('../src/worker/entry.ts'),
    read('../src/worker/agent-notification-event.ts'),
    read('../migrations/0011_agent_web_push.sql'),
    read('../migrations/0058_agent_push_payload_keys.sql'),
    read('../src/dashboard/agent-push.ts'),
    read('../src/dashboard/AgentWorkspaceChrome.tsx'),
  ]);

  assert.match(api, /requireAgentSession/u);
  assert.match(api, /agent_push_subscriptions/u);
  assert.match(api, /agent_id = \?2/u);
  assert.match(api, /agent\.session_id/u);
  assert.match(api, /session_id = excluded\.session_id/u);
  assert.match(
    delivery,
    /subscription\.agent_id = conversation\.assigned_agent/u,
  );
  assert.match(delivery, /JOIN agent_sessions session/u);
  assert.match(delivery, /session\.id = subscription\.session_id/u);
  assert.match(
    delivery,
    /datetime\(session\.expires_at\) > CURRENT_TIMESTAMP/u,
  );
  assert.match(delivery, /JOIN visitor_push_vapid vapid/u);
  assert.match(delivery, /sendDataLessPush/u);
  assert.match(delivery, /sendPayloadPush/u);
  assert.match(delivery, /notification\.messageId/u);
  assert.match(delivery, /conversationUnreadCount/u);
  assert.match(delivery, /AGENT_PUSH_TTL_SECONDS = 24 \* 60 \* 60/u);
  assert.match(delivery, /ttlSeconds: AGENT_PUSH_TTL_SECONDS/u);
  assert.doesNotMatch(delivery, /topic: 'agent-unread'/u);
  assert.match(entry, /sendAgentPushForMessage/u);
  assert.match(entry, /executionCtx\.waitUntil/u);
  assert.match(
    entry,
    /c\.get\('agentNotification'\)[\s\S]{0,100}agentNotificationForVisitorResponse/u,
  );
  assert.match(classification, /agentNotificationForConversationStart/u);
  assert.match(
    migration,
    /FOREIGN KEY \(agent_id\) REFERENCES agents\(id\) ON DELETE CASCADE/u,
  );
  assert.match(payloadMigration, /ADD COLUMN p256dh TEXT/u);
  assert.match(payloadMigration, /ADD COLUMN auth TEXT/u);
  assert.match(
    payloadMigration,
    /session_id TEXT REFERENCES agent_sessions\(id\) ON DELETE CASCADE/u,
  );
  assert.match(dashboard, /Notification\.requestPermission\(\)/u);
  assert.match(dashboard, /pushManager\.subscribe/u);
  assert.match(dashboard, /install-required/u);
  assert.match(dashboard, /bindAgentSubscription\(subscription, agentId/u);
  assert.match(dashboard, /cs-agent-push-binding:v4/u);
  assert.match(dashboard, /AGENT_SERVICE_WORKER_READY_TIMEOUT_MS = 15_000/u);
  assert.match(dashboard, /Promise\.race\(\[/u);
  assert.match(dashboard, /通知服务启动超时，请刷新页面后重试/u);
  assert.match(chrome, /客户消息通知/u);
  assert.match(chrome, /切后台、锁屏或离开页面也会提醒/u);
  assert.match(chrome, /工作台提示音/u);
  assert.match(chrome, /消息提醒：/u);
  assert.doesNotMatch(chrome, /前台提示音/u);
  assert.doesNotMatch(chrome, /后台可接收系统通知/u);
});
