import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
import { topLevelDeclaration } from './helpers/source-contract.mjs';

const mediaStore = readFileSync(
  new URL('../src/worker/media-store.ts', import.meta.url),
  'utf8',
);
const mediaApi = readFileSync(
  new URL('../src/worker/media-api.ts', import.meta.url),
  'utf8',
);

test('new media reservations avoid a post-insert read and scan limits once', () => {
  const reserveSource = topLevelDeclaration(
    mediaStore,
    'export async function reserveMedia',
  );

  assert.match(
    reserveSource,
    /COALESCE\(\s*SUM\(CASE WHEN status = 'pending'/u,
  );
  assert.doesNotMatch(reserveSource, /const row = await findMedia\(db, id\)/u);
  assert.equal(
    (reserveSource.match(/SELECT COUNT\(\*\)/gu) ?? []).length,
    2,
    'normal reservation should use one aggregate scan; the second count is conflict-only',
  );
});

test('visitor media ownership folds project validation into the normal D1 read', () => {
  const siteJoinCount = (
    mediaApi.match(/JOIN sites s ON s\.id = c\.site_id/gu) ?? []
  ).length;
  assert.equal(siteJoinCount, 2);
  assert.match(
    mediaApi,
    /AND \(s\.id = \?2 OR s\.public_key = \?2\) AND s\.is_enabled = 1/u,
  );
  assert.doesNotMatch(
    mediaApi,
    /if \(!conversation\) \{\s*const site = await findSite/u,
  );
  assert.doesNotMatch(
    mediaApi,
    /if \(!media\) \{\s*const site = await findSite/u,
  );
});

test('media completion keeps R2 verification while skipping stable overview scans', () => {
  assert.match(
    mediaStore,
    /const object = await env\.MEDIA\.head\(media\.object_key\)/u,
  );
  assert.doesNotMatch(mediaStore, /includeOverview: true/u);
  assert.match(
    mediaStore,
    /media\.sender_type === 'agent' &&\s*context\.conversationStatus === 'open'/u,
  );
  assert.match(mediaApi, /c\.status AS conversation_status/u);
});
