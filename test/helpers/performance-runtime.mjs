import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const repositoryDirectory = fileURLToPath(new URL('../../', import.meta.url));
const runtimeDirectory = mkdtempSync(
  join(tmpdir(), 'customer-service-performance-runtime-'),
);
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

const workerModule = (name) =>
  pathToFileURL(join(runtimeDirectory, 'src/worker', name)).href;

let agentApi;
let clientApi;
try {
  [{ agentApi }, { clientApi }] = await Promise.all([
    import(workerModule('agent-api.ts')),
    import(workerModule('client-api.ts')),
  ]);
} finally {
  rmSync(runtimeDirectory, { recursive: true, force: true });
}

export { agentApi, clientApi, DatabaseSync };

export function applyMigrations(database) {
  const directory = fileURLToPath(new URL('../../migrations/', import.meta.url));
  for (const name of readdirSync(directory)
    .filter((value) => /^\d+.*\.sql$/u.test(value))
    .sort()) {
    database.exec(readFileSync(`${directory}/${name}`, 'utf8'));
  }
}

export function createInstrumentedD1(database) {
  const statementExecutors = new WeakMap();
  let batchSequence = 0;
  let executionTail = Promise.resolve();
  let state = createMetricState();

  function enqueue(operation) {
    const execution = executionTail.then(operation, operation);
    executionTail = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }

  function executeStatement(sql, bindings, method, batchId = null, column) {
    const kind = statementKind(sql);
    state[method] += 1;
    const prepared = database.prepare(sql);
    let value;
    if (method === 'first') {
      const row = prepared.get(...bindings) ?? null;
      value = column === undefined || row === null ? row : (row[column] ?? null);
    } else if (method === 'all') {
      value = { results: prepared.all(...bindings) };
    } else {
      const result = prepared.run(...bindings);
      value = { meta: { changes: Number(result.changes) } };
    }
    const changes =
      kind === 'SELECT'
        ? 0
        : Number(
            database.prepare('SELECT changes() AS changes').get()?.changes ?? 0,
          );
    state.executions.push({
      sql,
      kind,
      method,
      batchId,
      changes,
    });
    state[kind.toLowerCase()] += 1;
    return value;
  }

  function prepare(sql) {
    state.prepare += 1;
    let bindings = [];
    const statement = {
      bind(...values) {
        bindings = values;
        return statement;
      },
      first(column) {
        return enqueue(() =>
          executeStatement(sql, bindings, 'first', null, column),
        );
      },
      all() {
        return enqueue(() => executeStatement(sql, bindings, 'all'));
      },
      run() {
        return enqueue(() => executeStatement(sql, bindings, 'run'));
      },
    };
    statementExecutors.set(statement, (batchId) =>
      executeStatement(sql, bindings, 'run', batchId),
    );
    return statement;
  }

  const db = {
    prepare,
    batch(statements) {
      state.batch += 1;
      state.batchStatements += statements.length;
      state.batchSizes.push(statements.length);
      const batchId = ++batchSequence;
      return enqueue(() => {
        const results = [];
        database.exec('BEGIN');
        try {
          for (const statement of statements) {
            const execute = statementExecutors.get(statement);
            if (!execute) throw new Error('Unknown instrumented D1 statement');
            results.push(execute(batchId));
          }
          database.exec('COMMIT');
          return results;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      });
    },
  };

  return {
    db,
    metrics() {
      return {
        prepare: state.prepare,
        first: state.first,
        all: state.all,
        run: state.run,
        batch: state.batch,
        batchStatements: state.batchStatements,
        batchSizes: [...state.batchSizes],
        executed: state.executions.length,
        select: state.select,
        insert: state.insert,
        update: state.update,
        delete: state.delete,
        executions: state.executions.map((execution) => ({ ...execution })),
      };
    },
    reset() {
      state = createMetricState();
    },
  };
}

function createMetricState() {
  return {
    prepare: 0,
    first: 0,
    all: 0,
    run: 0,
    batch: 0,
    batchStatements: 0,
    batchSizes: [],
    select: 0,
    insert: 0,
    update: 0,
    delete: 0,
    executions: [],
  };
}

function statementKind(sql) {
  let depth = 0;
  let quote = null;
  for (let index = 0; index < sql.length; ) {
    const char = sql[index];
    if (quote) {
      if (char === quote) {
        if (sql[index + 1] === quote) {
          index += 2;
          continue;
        }
        quote = null;
      }
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      index += 1;
      continue;
    }
    if (char === '(') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (depth === 0 && /[A-Za-z]/u.test(char)) {
      let end = index + 1;
      while (end < sql.length && /[A-Za-z]/u.test(sql[end])) end += 1;
      const word = sql.slice(index, end).toUpperCase();
      if (['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(word)) return word;
      index = end;
      continue;
    }
    index += 1;
  }
  throw new Error(`Unsupported D1 statement kind: ${sql.slice(0, 80)}`);
}

export function fakeRooms() {
  const calls = [];
  const events = new Map();
  return {
    calls,
    events,
    namespace: {
      idFromName(name) {
        return name;
      },
      get(name) {
        return {
          async fetch(_input, init) {
            calls.push(name);
            const current = events.get(name) ?? [];
            current.push(JSON.parse(String(init?.body ?? '{}')));
            events.set(name, current);
            return { status: 204 };
          },
        };
      },
    },
  };
}

export function blockingRooms() {
  const calls = [];
  const completed = [];
  const events = new Map();
  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  return {
    calls,
    completed,
    events,
    release() {
      releaseGate();
    },
    namespace: {
      idFromName(name) {
        return name;
      },
      get(name) {
        return {
          async fetch(_input, init) {
            calls.push(name);
            const current = events.get(name) ?? [];
            current.push(JSON.parse(String(init?.body ?? '{}')));
            events.set(name, current);
            await gate;
            completed.push(name);
            return { status: 204 };
          },
        };
      },
    },
  };
}

export function createExecutionContext() {
  const tasks = [];
  return {
    tasks,
    context: {
      waitUntil(task) {
        tasks.push(Promise.resolve(task));
      },
    },
    async drain() {
      await Promise.all(tasks);
    },
  };
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function executionsMatching(metrics, pattern, kind) {
  return metrics.executions.filter(
    (execution) =>
      (!kind || execution.kind === kind) && pattern.test(execution.sql),
  );
}

export function changedRows(executions) {
  return executions.reduce((sum, execution) => sum + execution.changes, 0);
}
