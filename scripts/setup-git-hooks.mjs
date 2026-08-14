import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.git')) process.exit(0);

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  stdio: 'inherit',
});

if (result.error) {
  console.warn(`Git hooks were not configured: ${result.error.message}`);
  process.exit(0);
}

process.exit(result.status ?? 0);
