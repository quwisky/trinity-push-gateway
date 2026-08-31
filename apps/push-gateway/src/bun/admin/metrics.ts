import type {
  FcmMetricOutcome,
  FcmMetricRow,
  GatewayMetricsSink,
  MetricPlatform,
  MetricsBatch,
  RequestMetricOutcome,
  RequestMetricRow,
} from '../../metrics';
import { utcHourSeconds } from '../../metrics';

const FLUSH_INTERVAL_MS = 5_000;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER;

type MutableRequestMetricRow = {
  -readonly [K in keyof RequestMetricRow]: RequestMetricRow[K];
};
type MutableFcmMetricRow = {
  -readonly [K in keyof FcmMetricRow]: FcmMetricRow[K];
};

function increment(value: number): number {
  return value >= MAX_COUNTER ? MAX_COUNTER : value + 1;
}

function add(left: number, right: number): number {
  return Math.min(MAX_COUNTER, left + right);
}

function emptyRequest(hour: number): MutableRequestMetricRow {
  return {
    hour,
    invalid: 0,
    processed: 0,
    rateLimited: 0,
    safetyBudgetExhausted: 0,
    storageUnavailable: 0,
  };
}

function emptyFcm(hour: number, platform: MetricPlatform): MutableFcmMetricRow {
  return {
    accepted: 0,
    attempted: 0,
    hour,
    latency1000To2499: 0,
    latency10000OrMore: 0,
    latency100To249: 0,
    latency2500To4999: 0,
    latency250To499: 0,
    latency5000To9999: 0,
    latency500To999: 0,
    latencyUnder100: 0,
    permanentlyRejected: 0,
    platform,
    transientFailure: 0,
  };
}

type LatencyField =
  | 'latencyUnder100'
  | 'latency100To249'
  | 'latency250To499'
  | 'latency500To999'
  | 'latency1000To2499'
  | 'latency2500To4999'
  | 'latency5000To9999'
  | 'latency10000OrMore';

function latencyBucket(latencyMs: number): LatencyField {
  if (latencyMs < 100) return 'latencyUnder100';
  if (latencyMs < 250) return 'latency100To249';
  if (latencyMs < 500) return 'latency250To499';
  if (latencyMs < 1_000) return 'latency500To999';
  if (latencyMs < 2_500) return 'latency1000To2499';
  if (latencyMs < 5_000) return 'latency2500To4999';
  if (latencyMs < 10_000) return 'latency5000To9999';
  return 'latency10000OrMore';
}

export class BoundedMetricsAccumulator implements GatewayMetricsSink {
  private readonly fcm = new Map<string, MutableFcmMetricRow>();
  private readonly requests = new Map<number, MutableRequestMetricRow>();

  recordRequest(outcome: RequestMetricOutcome, occurredAtMs: number): void {
    const hour = utcHourSeconds(occurredAtMs);
    const row = this.requests.get(hour) ?? emptyRequest(hour);
    row[outcome] = increment(row[outcome]);
    this.requests.set(hour, row);
    this.trim();
  }

  recordFcmAttempt(
    platform: MetricPlatform,
    outcome: FcmMetricOutcome,
    latencyMs: number,
    occurredAtMs: number,
  ): void {
    const hour = utcHourSeconds(occurredAtMs);
    const key = `${String(hour)}:${platform}`;
    const row = this.fcm.get(key) ?? emptyFcm(hour, platform);
    row.attempted = increment(row.attempted);
    row[outcome] = increment(row[outcome]);
    const bucket = latencyBucket(Math.max(0, latencyMs));
    row[bucket] = increment(row[bucket]);
    this.fcm.set(key, row);
    this.trim();
  }

  take(): MetricsBatch {
    const batch = {
      fcm: [...this.fcm.values()],
      requests: [...this.requests.values()],
    };
    this.fcm.clear();
    this.requests.clear();
    return batch;
  }

  absorb(batch: MetricsBatch): void {
    for (const incoming of batch.requests) {
      const row =
        this.requests.get(incoming.hour) ?? emptyRequest(incoming.hour);
      for (const outcome of [
        'processed',
        'invalid',
        'rateLimited',
        'safetyBudgetExhausted',
        'storageUnavailable',
      ] as const) {
        row[outcome] = add(row[outcome], incoming[outcome]);
      }
      this.requests.set(row.hour, row);
    }
    for (const incoming of batch.fcm) {
      const key = `${String(incoming.hour)}:${incoming.platform}`;
      const row =
        this.fcm.get(key) ?? emptyFcm(incoming.hour, incoming.platform);
      for (const field of [
        'accepted',
        'attempted',
        'latency1000To2499',
        'latency10000OrMore',
        'latency100To249',
        'latency2500To4999',
        'latency250To499',
        'latency5000To9999',
        'latency500To999',
        'latencyUnder100',
        'permanentlyRejected',
        'transientFailure',
      ] as const) {
        row[field] = add(row[field], incoming[field]);
      }
      this.fcm.set(key, row);
    }
    this.trim();
  }

  get empty(): boolean {
    return this.fcm.size === 0 && this.requests.size === 0;
  }

  private trim(): void {
    const hours = [
      ...new Set([
        ...this.requests.keys(),
        ...[...this.fcm.values()].map(({ hour }) => hour),
      ]),
    ].sort((left, right) => right - left);
    for (const hour of hours.slice(2)) {
      this.requests.delete(hour);
      this.fcm.delete(`${String(hour)}:android`);
      this.fcm.delete(`${String(hour)}:ios`);
    }
  }
}

export type MetricsWriter = GatewayMetricsSink & Readonly<{ close(): void }>;

export function createMetricsWriter(
  databasePath: string,
  log: (event: Readonly<Record<string, unknown>>) => void,
  options: Readonly<{ flushIntervalMs?: number }> = {},
): MetricsWriter {
  const active = new BoundedMetricsAccumulator();
  const pending = new BoundedMetricsAccumulator();
  const worker = new Worker(
    new URL('./metrics-writer.worker.js', import.meta.url).href,
    { name: 'metrics-writer', ref: false },
  );
  let alive = true;
  let ready = false;
  let inFlight = false;
  let nextId = 1;

  const disable = (): void => {
    if (!alive) return;
    alive = false;
    active.take();
    pending.take();
    log({ event: 'admin_metrics_unavailable', outcome: 'dropped' });
  };
  const flush = (): void => {
    if (!alive || !ready || inFlight || active.empty) return;
    const batch = active.take();
    inFlight = true;
    worker.postMessage({ batch, id: nextId, kind: 'write' });
    nextId += 1;
  };
  worker.addEventListener('error', disable);
  worker.addEventListener('close', disable);
  worker.addEventListener('message', (event) => {
    const message = event.data as { kind?: string };
    if (message.kind === 'ready') {
      ready = true;
      flush();
    } else if (message.kind === 'written') {
      inFlight = false;
      active.absorb(pending.take());
      flush();
    }
  });
  worker.postMessage({ databasePath, kind: 'initialize' });
  const timer = setInterval(
    flush,
    options.flushIntervalMs ?? FLUSH_INTERVAL_MS,
  );
  timer.unref();

  const target = (): BoundedMetricsAccumulator => (inFlight ? pending : active);
  return Object.freeze({
    close(): void {
      clearInterval(timer);
      if (alive) {
        worker.postMessage({ kind: 'stop' });
        setTimeout(() => {
          worker.terminate();
        }, 250).unref();
      }
      alive = false;
    },
    recordFcmAttempt(platform, outcome, latencyMs, occurredAtMs): void {
      if (alive)
        target().recordFcmAttempt(platform, outcome, latencyMs, occurredAtMs);
    },
    recordRequest(outcome, occurredAtMs): void {
      if (alive) target().recordRequest(outcome, occurredAtMs);
    },
  });
}
