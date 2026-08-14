from pathlib import Path

path = Path('test/customer-service-full-flow.test.mjs')
source = path.read_text(encoding='utf-8')
source = source.replace(
    "import { readdirSync, readFileSync } from 'node:fs';",
    "import { existsSync, readdirSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs';",
)
source = source.replace(
    "import { DatabaseSync } from 'node:sqlite';",
    "import { join } from 'node:path';\nimport { DatabaseSync } from 'node:sqlite';",
)
source = source.replace(
    "import { fileURLToPath } from 'node:url';",
    "import { fileURLToPath, URL } from 'node:url';",
)
source = source.replace(
    "import { agentApi } from '../src/worker/agent-api.ts';\nimport { clientApi } from '../src/worker/client-api.ts';",
    """const workerDirectory = fileURLToPath(
  new URL('../src/worker/', import.meta.url),
);
const moduleShims = [];
for (const name of readdirSync(workerDirectory)) {
  if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue;
  const shimPath = join(workerDirectory, name.slice(0, -3));
  if (existsSync(shimPath)) continue;
  symlinkSync(name, shimPath);
  moduleShims.push(shimPath);
}

let agentApi;
let clientApi;
try {
  [{ agentApi }, { clientApi }] = await Promise.all([
    import('../src/worker/agent-api.ts'),
    import('../src/worker/client-api.ts'),
  ]);
} finally {
  for (const shimPath of moduleShims) unlinkSync(shimPath);
}""",
)
path.write_text(source, encoding='utf-8')
