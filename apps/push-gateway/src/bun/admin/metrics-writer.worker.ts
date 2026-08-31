import { Database } from 'bun:sqlite';

import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import type { MetricsBatch } from '../../metrics';
import { adminSchema, fcmMetricsHourly, requestMetricsHourly } from './schema';

type WorkerMessage =
  | Readonly<{ databasePath: string; kind: 'initialize' }>
  | Readonly<{ batch: MetricsBatch; id: number; kind: 'write' }>
  | Readonly<{ kind: 'stop' }>;

let database: Database | undefined;

function boundedAdd(column: SQLWrapper, value: number): SQL<number> {
  return sql<number>`min(${column} + ${value}, ${Number.MAX_SAFE_INTEGER})`;
}

function open(databasePath: string): void {
  database = new Database(databasePath, { create: false, strict: true });
  database.run('PRAGMA foreign_keys = ON');
  database.run('PRAGMA busy_timeout = 50');
}

function write(batch: MetricsBatch): void {
  if (database === undefined) {
    throw new Error('Metrics writer was not initialized.');
  }
  const query = drizzle(database, { schema: adminSchema });
  const transaction = database.transaction(() => {
    for (const row of batch.requests) {
      query
        .insert(requestMetricsHourly)
        .values(row)
        .onConflictDoUpdate({
          set: {
            invalid: boundedAdd(requestMetricsHourly.invalid, row.invalid),
            processed: boundedAdd(
              requestMetricsHourly.processed,
              row.processed,
            ),
            rateLimited: boundedAdd(
              requestMetricsHourly.rateLimited,
              row.rateLimited,
            ),
            safetyBudgetExhausted: boundedAdd(
              requestMetricsHourly.safetyBudgetExhausted,
              row.safetyBudgetExhausted,
            ),
            storageUnavailable: boundedAdd(
              requestMetricsHourly.storageUnavailable,
              row.storageUnavailable,
            ),
          },
          target: requestMetricsHourly.hour,
        })
        .run();
    }
    for (const row of batch.fcm) {
      query
        .insert(fcmMetricsHourly)
        .values(row)
        .onConflictDoUpdate({
          set: {
            accepted: boundedAdd(fcmMetricsHourly.accepted, row.accepted),
            attempted: boundedAdd(fcmMetricsHourly.attempted, row.attempted),
            latency1000To2499: boundedAdd(
              fcmMetricsHourly.latency1000To2499,
              row.latency1000To2499,
            ),
            latency10000OrMore: boundedAdd(
              fcmMetricsHourly.latency10000OrMore,
              row.latency10000OrMore,
            ),
            latency100To249: boundedAdd(
              fcmMetricsHourly.latency100To249,
              row.latency100To249,
            ),
            latency2500To4999: boundedAdd(
              fcmMetricsHourly.latency2500To4999,
              row.latency2500To4999,
            ),
            latency250To499: boundedAdd(
              fcmMetricsHourly.latency250To499,
              row.latency250To499,
            ),
            latency5000To9999: boundedAdd(
              fcmMetricsHourly.latency5000To9999,
              row.latency5000To9999,
            ),
            latency500To999: boundedAdd(
              fcmMetricsHourly.latency500To999,
              row.latency500To999,
            ),
            latencyUnder100: boundedAdd(
              fcmMetricsHourly.latencyUnder100,
              row.latencyUnder100,
            ),
            permanentlyRejected: boundedAdd(
              fcmMetricsHourly.permanentlyRejected,
              row.permanentlyRejected,
            ),
            transientFailure: boundedAdd(
              fcmMetricsHourly.transientFailure,
              row.transientFailure,
            ),
          },
          target: [fcmMetricsHourly.hour, fcmMetricsHourly.platform],
        })
        .run();
    }
  });
  transaction.immediate();
}

self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.kind === 'initialize') {
    open(message.databasePath);
    postMessage({ kind: 'ready' });
    return;
  }
  if (message.kind === 'stop') {
    database?.close(true);
    postMessage({ kind: 'stopped' });
    process.exit(0);
  }
  write(message.batch);
  postMessage({ id: message.id, kind: 'written' });
});
