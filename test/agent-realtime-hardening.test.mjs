import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/dashboard/App.tsx', import.meta.url),
  'utf8',
);

test('heartbeat only maintains presence instead of polling every 30 seconds', () => {
  assert.match(source, /setInterval\(beat, 30_000\)/u);
  assert.doesNotMatch(source, /heartbeat\(\)[\s\S]{0,80}\.then\(refresh\)/u);
});

test('agent sockets reconnect and recover after disconnects', () => {
  assert.match(
    source,
    /setInboxConnected\(false\)[\s\S]{0,140}setTimeout\(connect, 1200\)/u,
  );
  assert.match(
    source,
    /setThreadConnected\(false\)[\s\S]{0,140}setTimeout\(connect, 1200\)/u,
  );
  assert.match(source, /visibilitychange/u);
  assert.match(source, /addEventListener\('online', recover\)/u);
});

test('thread guards sends and follows new messages', () => {
  assert.match(source, /const \[sending, setSending\] = useState\(false\)/u);
  assert.match(source, /nativeEvent\.isComposing/u);
  assert.match(source, /messagesRef/u);
  assert.match(source, /timeline\.scrollTo/u);
  assert.match(source, /setDraft\(\(current\) => current \|\| text\)/u);
});
