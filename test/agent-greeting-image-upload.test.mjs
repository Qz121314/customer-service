import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import { normalizeMediaInput } from '../src/worker/media-types.ts';

const clientSource = readFileSync(
  fileURLToPath(
    new URL('../src/dashboard/agent-attachments-client.ts', import.meta.url),
  ),
  'utf8',
);

test('static greeting image formats remain valid only with decoded dimensions', () => {
  for (const mimeType of ['image/jpeg', 'image/png', 'image/webp']) {
    const media = normalizeMediaInput({
      mimeType,
      byteSize: 1024,
      width: 640,
      height: 360,
      originalName: 'greeting-image',
    });
    assert.equal(media?.mimeType, mimeType);
    assert.equal(media?.width, 640);
    assert.equal(media?.height, 360);
  }

  assert.equal(
    normalizeMediaInput({
      mimeType: 'image/jpeg',
      byteSize: 1024,
      originalName: 'greeting.jpg',
    }),
    null,
  );
  assert.equal(
    normalizeMediaInput({
      mimeType: 'image/png',
      byteSize: 1024 * 1024 + 1,
      width: 640,
      height: 360,
      originalName: 'too-large.png',
    }),
    null,
  );

  const gif = normalizeMediaInput({
    mimeType: 'image/gif',
    byteSize: 1024,
    originalName: 'greeting.gif',
  });
  assert.equal(gif?.mimeType, 'image/gif');
  assert.equal(gif?.width, null);
  assert.equal(gif?.height, null);
});

test('greeting image client sends decoded static image dimensions to the Worker', () => {
  const uploadStartMarker = 'export async function uploadAgentAttachmentImage(';
  const uploadEndMarker = 'export async function sendAgentPresetAttachments(';
  const helperStartMarker = 'async function readGreetingImageDimensions(';
  const helperEndMarker = 'async function attachmentRequest<';
  const uploadStart = clientSource.indexOf(uploadStartMarker);
  const uploadEnd = clientSource.indexOf(uploadEndMarker);
  const helperStart = clientSource.indexOf(helperStartMarker);
  const helperEnd = clientSource.indexOf(helperEndMarker);

  assert.notEqual(uploadStart, -1, 'greeting image upload function must exist');
  assert.notEqual(uploadEnd, -1, 'upload function boundary must exist');
  assert.notEqual(helperStart, -1, 'image dimension helper must exist');
  assert.notEqual(helperEnd, -1, 'dimension helper boundary must exist');
  assert.ok(uploadEnd > uploadStart, 'upload function source must be bounded');
  assert.ok(helperEnd > helperStart, 'dimension helper source must be bounded');

  const uploadSource = clientSource.slice(uploadStart, uploadEnd);
  const helperSource = clientSource.slice(helperStart, helperEnd);

  assert.match(uploadSource, /await readGreetingImageDimensions\(file\)/u);
  assert.match(
    uploadSource,
    /form\.set\('width', String\(dimensions\.width\)\)/u,
  );
  assert.match(
    uploadSource,
    /form\.set\('height', String\(dimensions\.height\)\)/u,
  );
  assert.match(helperSource, /image\/gif/u);
  assert.match(helperSource, /createImageBitmap\(file,/u);
  assert.match(helperSource, /imageOrientation: 'from-image'/u);
  assert.match(helperSource, /bitmap\.close\(\)/u);
});
