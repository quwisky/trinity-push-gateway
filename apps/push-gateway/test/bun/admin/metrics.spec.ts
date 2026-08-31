import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  BoundedMetricsAccumulator,
  createMetricsWriter,
} from '../../../src/bun/admin/metrics';
import { SqliteAdminStore } from '../../../src/bun/admin/store';
import { readMigrations } from '../../../src/bun/migrations';

const ADMIN_MIGRATIONS = readMigrations(
  path.join(import.meta.dir, '../../../admin-migrations'),
);

describe('bounded administration metrics', () => {
  it('uses only fixed labels and retains at most two UTC hours', () => {
    const metrics = new BoundedMetricsAccumulator();
    metrics.recordRequest('invalid', Date.UTC(2026, 0, 1, 0, 30));
    metrics.recordRequest('processed', Date.UTC(2026, 0, 1, 1, 30));
    metrics.recordRequest('rateLimited', Date.UTC(2026, 0, 1, 2, 30));
    metrics.recordFcmAttempt(
      'android',
      'accepted',
      249,
      Date.UTC(2026, 0, 1, 2, 31),
    );
    metrics.recordFcmAttempt(
      'ios',
      'transientFailure',
      10_000,
      Date.UTC(2026, 0, 1, 2, 32),
    );

    expect(metrics.take()).toEqual({
      fcm: [
        expect.objectContaining({
          accepted: 1,
          attempted: 1,
          latency100To249: 1,
          platform: 'android',
        }),
        expect.objectContaining({
          attempted: 1,
          latency10000OrMore: 1,
          platform: 'ios',
          transientFailure: 1,
        }),
      ],
      requests: [
        expect.objectContaining({ processed: 1 }),
        expect.objectContaining({ rateLimited: 1 }),
      ],
    });
    expect(metrics.empty).toBe(true);
  });

  it('flushes through the isolated Worker and becomes drop-only after writer death', async () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), 'trinity-metrics-worker-'),
    );
    const databasePath = path.join(directory, 'admin.sqlite');
    const store = SqliteAdminStore.open(databasePath, ADMIN_MIGRATIONS);
    const events: Readonly<Record<string, unknown>>[] = [];
    const writer = createMetricsWriter(
      databasePath,
      (event) => events.push(event),
      { flushIntervalMs: 5 },
    );
    try {
      writer.recordRequest('processed', Date.UTC(2026, 0, 1, 0, 1));
      writer.recordFcmAttempt(
        'android',
        'accepted',
        99,
        Date.UTC(2026, 0, 1, 0, 2),
      );
      for (let index = 0; index < 50; index += 1) {
        const rows = store.metrics(
          Date.UTC(2026, 0, 1) / 1_000,
          Date.UTC(2026, 0, 1, 1) / 1_000,
        );
        if (rows.requests.length === 1 && rows.fcm.length === 1) break;
        await Bun.sleep(10);
      }
      expect(
        store.metrics(
          Date.UTC(2026, 0, 1) / 1_000,
          Date.UTC(2026, 0, 1, 1) / 1_000,
        ),
      ).toMatchObject({
        fcm: [{ accepted: 1, attempted: 1, latencyUnder100: 1 }],
        requests: [{ processed: 1 }],
      });

      store.close();
      const database = new Database(databasePath);
      database.run('DROP TABLE request_metrics_hourly');
      database.close(true);
      writer.recordRequest('invalid', Date.UTC(2026, 0, 1, 0, 3));
      for (let index = 0; index < 50 && events.length === 0; index += 1) {
        await Bun.sleep(10);
      }
      expect(events).toContainEqual({
        event: 'admin_metrics_unavailable',
        outcome: 'dropped',
      });
      expect(() => {
        writer.recordRequest('invalid', Date.UTC(2026, 0, 1, 0, 4));
      }).not.toThrow();
    } finally {
      writer.close();
      try {
        store.close();
      } catch {
        // The store was intentionally closed before corruption.
      }
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
