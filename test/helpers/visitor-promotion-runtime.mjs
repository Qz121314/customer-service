import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const repositoryDirectory = fileURLToPath(new URL('../../', import.meta.url));
const runtimeDirectory = mkdtempSync(join(tmpdir(), 'visitor-promotion-runtime-'));
symlinkSync(
  join(repositoryDirectory, 'node_modules'),
  join(runtimeDirectory, 'node_modules'),
  'dir',
);
for (const relativeDirectory of ['src/worker', 'src/shared']) {
  const sourceDirectory = join(repositoryDirectory, relativeDirectory);
  const targetDirectory = join(runtimeDirectory, relativeDirectory);
  mkdirSync(targetDirectory, { recursive: true });
  for (const name of readdirSync(sourceDirectory)) {
    if (!name.endsWith('.ts')) continue;
    copyFileSync(join(sourceDirectory, name), join(targetDirectory, name));
    if (!name.endsWith('.d.ts')) {
      symlinkSync(name, join(targetDirectory, name.slice(0, -3)));
    }
  }
}

let visitorPromotionApi;
try {
  ({ visitorPromotionApi } = await import(
    pathToFileURL(
      join(runtimeDirectory, 'src/worker/visitor-promotion-api.ts'),
    ).href
  ));
} finally {
  rmSync(runtimeDirectory, { recursive: true, force: true });
}

export { visitorPromotionApi };
