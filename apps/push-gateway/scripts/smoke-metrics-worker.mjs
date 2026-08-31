import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workspaceRoot = path.resolve(import.meta.dir, '../../..');
const workerUrl = new URL(
  '../../../dist/apps/push-gateway/bun/metrics-writer.worker.js',
  import.meta.url,
);
const directory = mkdtempSync(
  path.join(tmpdir(), 'trinity-built-metrics-worker-'),
);
const databasePath = path.join(directory, 'admin.sqlite');
const database = new Database(databasePath, { create: true, strict: true });
for (const name of [
  '0001_admin_foundation.sql',
  '0002_observability_operations.sql',
]) {
  database.exec(
    readFileSync(
      path.join(workspaceRoot, 'apps/push-gateway/admin-migrations', name),
      'utf8',
    ),
  );
}

const worker = new Worker(workerUrl.href, {
  name: 'built-metrics-writer-smoke',
  ref: false,
});
let failed;
worker.addEventListener('error', (event) => {
  failed = new Error(`Built metrics Worker failed: ${event.message}`);
});

function message(kind) {
  return Promise.race([
    new Promise((resolve) => {
      const listener = (event) => {
        if (event.data?.kind === kind) {
          worker.removeEventListener('message', listener);
          resolve(event.data);
        }
      };
      worker.addEventListener('message', listener);
    }),
    Bun.sleep(2_000).then(() => {
      throw new Error(`Built metrics Worker did not emit ${kind}.`);
    }),
  ]);
}

try {
  const ready = message('ready');
  worker.postMessage({ databasePath, kind: 'initialize' });
  await ready;
  if (failed !== undefined) throw failed;
  const written = message('written');
  worker.postMessage({
    batch: {
      fcm: [],
      requests: [
        {
          hour: 0,
          invalid: 0,
          processed: 1,
          rateLimited: 0,
          safetyBudgetExhausted: 0,
          storageUnavailable: 0,
        },
      ],
    },
    id: 1,
    kind: 'write',
  });
  await written;
  if (failed !== undefined) throw failed;
  const row = database
    .query('SELECT processed FROM request_metrics_hourly WHERE hour = 0')
    .get();
  if (row?.processed !== 1) {
    throw new Error('Built metrics Worker did not persist its fixed batch.');
  }
  const stopped = message('stopped');
  worker.postMessage({ kind: 'stop' });
  await stopped;
  console.info('Built metrics Worker initialized, flushed, and stopped.');
} finally {
  worker.terminate();
  database.close(true);
  rmSync(directory, { force: true, recursive: true });
}
