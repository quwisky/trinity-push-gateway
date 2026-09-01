import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DynamicForm, FormConfig } from '@ng-forge/dynamic-forms';
import { standardSchema } from '@ng-forge/dynamic-forms/schema';
import { METRICS_QUERY_POLICY } from '../../api/admin-contract.generated';
import type {
  FcmMetricBucket,
  GetMetricsParams,
  Metrics,
  MetricsInterval,
  RequestMetricBucket,
} from '../../api/generated/admin-api.schemas';
import { MetricsService } from '../../api/generated/metrics/metrics.service';
import { RemoteQuery } from '../../core/remote-state/remote-query';
import { StatusAnnouncer } from '../../core/status/status-announcer';
import { TimeService } from '../../core/time/time.service';
import { metricsFilterSchema } from '../../core/validation/schemas';
import { RemoteStatus } from '../../ui/remote-status';
import '../../ui/form/spartan-form.types';
import { GatewayChart, GatewayChartSeries } from './gateway-chart';
import { includesCurrentUtcBucket } from './metrics-range';

const utcBucketLabel = (timestamp: string, interval: MetricsInterval): string =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(interval === 'hour' ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(timestamp));

const requestColors = [
  '#0f766e',
  '#b42318',
  '#b7791f',
  '#6b46c1',
  '#52605c',
] as const;
const fcmColors = [
  '#0f766e',
  '#b42318',
  '#b7791f',
  '#2563eb',
  '#9f1239',
  '#7c3aed',
] as const;

@Component({
  selector: 'tpg-metrics-page',
  imports: [DynamicForm, GatewayChart, RemoteStatus],
  templateUrl: './metrics.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricsPage {
  private readonly metricsApi = inject(MetricsService);
  private readonly announcer = inject(StatusAnnouncer);
  private readonly time = inject(TimeService);
  private readonly initialTo = new Date();
  private readonly initialFrom = new Date(
    this.initialTo.getTime() - METRICS_QUERY_POLICY.defaultRangeSeconds * 1_000,
  );

  protected readonly metricsPolicy = METRICS_QUERY_POLICY;
  protected readonly parameters = signal<GetMetricsParams>({
    from: this.initialFrom.toISOString(),
    to: this.initialTo.toISOString(),
    interval: METRICS_QUERY_POLICY.defaultInterval,
  });
  protected readonly remote = new RemoteQuery<Metrics>(
    () => this.metricsApi.getMetrics(this.parameters()),
    {
      automaticRefreshWhen: () => includesCurrentUtcBucket(this.parameters()),
      requestKey: () => this.parameters(),
    },
  );
  protected readonly filterForm = {
    fields: [
      {
        key: 'from',
        type: 'datetime',
        value: this.time.toDateTimeLocal(this.initialFrom),
        label: 'From',
        props: { hint: 'Inclusive start, interpreted in browser local time.' },
      },
      {
        key: 'to',
        type: 'datetime',
        value: this.time.toDateTimeLocal(this.initialTo),
        label: 'To',
        props: { hint: 'Exclusive end, interpreted in browser local time.' },
      },
      {
        key: 'interval',
        type: 'select',
        value: METRICS_QUERY_POLICY.defaultInterval,
        label: 'Interval',
        options: METRICS_QUERY_POLICY.intervals.map((interval) => ({
          value: interval,
          label: `${interval.charAt(0).toUpperCase()}${interval.slice(1)}`,
        })),
      },
      { key: 'apply', type: 'submit', label: 'Apply range' },
    ],
    schema: standardSchema(metricsFilterSchema),
    options: { idPrefix: 'metrics-filter' },
  } as const satisfies FormConfig;
  protected readonly metrics = this.remote.data;
  protected readonly requestLabels = computed(() =>
    (this.metrics()?.requestBuckets ?? []).map((bucket) =>
      utcBucketLabel(
        bucket.from,
        this.metrics()?.interval ?? METRICS_QUERY_POLICY.defaultInterval,
      ),
    ),
  );
  protected readonly requestSeries = computed<readonly GatewayChartSeries[]>(
    () => {
      const buckets = this.metrics()?.requestBuckets ?? [];
      return requestSeries(buckets);
    },
  );
  protected readonly fcmLabels = computed(() =>
    fcmRows(this.metrics()?.fcmBuckets ?? []).map(({ from }) =>
      utcBucketLabel(
        from,
        this.metrics()?.interval ?? METRICS_QUERY_POLICY.defaultInterval,
      ),
    ),
  );
  protected readonly fcmSeries = computed<readonly GatewayChartSeries[]>(() =>
    fcmOutcomeSeries(this.metrics()?.fcmBuckets ?? []),
  );
  protected readonly latencySeries = computed<readonly GatewayChartSeries[]>(
    () => fcmLatencySeries(this.metrics()?.fcmBuckets ?? []),
  );

  protected reload(): Promise<unknown> {
    return this.remote.refresh();
  }

  protected async applyFilters(
    value: Readonly<{ from?: string; to?: string; interval?: string }>,
  ): Promise<void> {
    if (
      typeof value.from !== 'string' ||
      typeof value.to !== 'string' ||
      !isMetricsInterval(value.interval)
    ) {
      this.announcer.announce('The metrics range is incomplete.');
      return;
    }
    const from = this.time.fromDateTimeLocal(value.from);
    const to = this.time.fromDateTimeLocal(value.to);
    if (!from || !to) {
      this.announcer.announce('The metrics range could not be interpreted.');
      return;
    }
    this.parameters.set({ from, to, interval: value.interval });
    await this.reload();
    this.announcer.announce('Metrics range applied.');
  }
}

const isMetricsInterval = (value: unknown): value is MetricsInterval =>
  METRICS_QUERY_POLICY.intervals.some((interval) => interval === value);

const requestSeries = (
  buckets: readonly RequestMetricBucket[],
): readonly GatewayChartSeries[] => [
  {
    label: 'Processed',
    values: buckets.map(({ outcomes }) => outcomes.processed),
    color: requestColors[0],
  },
  {
    label: 'Invalid',
    values: buckets.map(({ outcomes }) => outcomes.invalid),
    color: requestColors[1],
  },
  {
    label: 'Rate limited',
    values: buckets.map(({ outcomes }) => outcomes.rateLimited),
    color: requestColors[2],
  },
  {
    label: 'Safety budget exhausted',
    values: buckets.map(({ outcomes }) => outcomes.safetyBudgetExhausted),
    color: requestColors[3],
  },
  {
    label: 'Storage unavailable',
    values: buckets.map(({ outcomes }) => outcomes.storageUnavailable),
    color: requestColors[4],
  },
];

type FcmRow = Readonly<{
  from: string;
  android?: FcmMetricBucket;
  ios?: FcmMetricBucket;
}>;

const fcmRows = (buckets: readonly FcmMetricBucket[]): readonly FcmRow[] => {
  const rows = new Map<
    string,
    { from: string; android?: FcmMetricBucket; ios?: FcmMetricBucket }
  >();
  for (const bucket of buckets) {
    const row = rows.get(bucket.from) ?? { from: bucket.from };
    row[bucket.platform] = bucket;
    rows.set(bucket.from, row);
  }
  return [...rows.values()].sort((left, right) =>
    left.from.localeCompare(right.from),
  );
};

const fcmOutcomeSeries = (
  buckets: readonly FcmMetricBucket[],
): readonly GatewayChartSeries[] => {
  const rows = fcmRows(buckets);
  return [
    {
      label: 'Android accepted',
      values: rows.map(({ android }) => android?.outcomes.accepted ?? 0),
      color: fcmColors[0],
    },
    {
      label: 'Android permanently rejected',
      values: rows.map(
        ({ android }) => android?.outcomes.permanentlyRejected ?? 0,
      ),
      color: fcmColors[1],
    },
    {
      label: 'Android transient failure',
      values: rows.map(
        ({ android }) => android?.outcomes.transientFailure ?? 0,
      ),
      color: fcmColors[2],
    },
    {
      label: 'iOS accepted',
      values: rows.map(({ ios }) => ios?.outcomes.accepted ?? 0),
      color: fcmColors[3],
    },
    {
      label: 'iOS permanently rejected',
      values: rows.map(({ ios }) => ios?.outcomes.permanentlyRejected ?? 0),
      color: fcmColors[4],
    },
    {
      label: 'iOS transient failure',
      values: rows.map(({ ios }) => ios?.outcomes.transientFailure ?? 0),
      color: fcmColors[5],
    },
  ];
};

const fcmLatencySeries = (
  buckets: readonly FcmMetricBucket[],
): readonly GatewayChartSeries[] => {
  const rows = fcmRows(buckets);
  return [
    {
      label: 'Android approximate p95',
      values: rows.map(({ android }) => android?.latency.approxP95Ms ?? null),
      color: fcmColors[0],
    },
    {
      label: 'iOS approximate p95',
      values: rows.map(({ ios }) => ios?.latency.approxP95Ms ?? null),
      color: fcmColors[3],
    },
  ];
};
