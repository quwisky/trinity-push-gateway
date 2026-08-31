import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DynamicForm, FormConfig } from '@ng-forge/dynamic-forms';
import { standardSchema } from '@ng-forge/dynamic-forms/schema';
import { from, of } from 'rxjs';
import { METRICS_QUERY_POLICY } from '../../api/admin-contract.generated';
import type {
  FcmMetricBucket,
  GetMetricsParams,
  Metrics,
  MetricsInterval,
  RequestMetricBucket,
} from '../../api/generated/admin-api.schemas';
import { MetricsService } from '../../api/generated/metrics/metrics.service';
import { RemoteResource } from '../../api/remote-resource';
import { pollWhileVisible } from '../../core/polling/visibility-poller';
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
  template: `
    <header class="page-header">
      <p class="eyebrow">Privacy-preserving aggregates</p>
      <h1>Metrics</h1>
      <p class="lede">
        Fixed-cardinality UTC outcomes without Notification Request, account, or
        Client Installation identifiers. Accepted means FCM accepted the call;
        it is not proof of device delivery.
      </p>
      <tpg-remote-status
        [state]="resource.state()"
        label="metrics"
        (retry)="reload()"
      />
    </header>

    <section
      class="content-panel filter-panel"
      aria-labelledby="metrics-filter-title"
    >
      <div class="section-heading">
        <div>
          <p class="eyebrow">UTC range</p>
          <h2 id="metrics-filter-title">Choose an interval</h2>
        </div>
        <span class="status-pill">
          Maximum {{ metricsPolicy.maximumRangeDays }} days
        </span>
      </div>
      <form
        class="filter-form three-columns"
        [dynamic-form]="filterForm"
        (submitted)="applyFilters($event)"
      ></form>
      <p class="field-hint">
        Date controls are interpreted in browser local time. Results and tables
        use UTC buckets; the global time control affects human-readable event
        timestamps elsewhere.
      </p>
    </section>

    @if (metrics(); as data) {
      @if (data.requestBuckets.length === 0 && data.fcmBuckets.length === 0) {
        <section class="empty-state" aria-labelledby="metrics-empty-title">
          <h2 id="metrics-empty-title">No aggregate activity in this range</h2>
          <p>The query succeeded, but no UTC buckets were recorded.</p>
        </section>
      } @else {
        <section
          class="content-panel chart-panel"
          aria-labelledby="request-outcomes-title"
        >
          <div class="section-heading">
            <div>
              <p class="eyebrow">Stacked outcomes</p>
              <h2 id="request-outcomes-title">Notification Requests</h2>
            </div>
            <span class="status-pill">{{ data.interval }} buckets</span>
          </div>
          <tpg-gateway-chart
            [labels]="requestLabels()"
            [series]="requestSeries()"
            [stacked]="true"
            accessibleLabel="Stacked Notification Request outcomes by UTC interval. The following table contains the same values."
            tableCaption="Notification Request outcomes by UTC interval"
          />
        </section>

        <section
          class="content-panel chart-panel"
          aria-labelledby="fcm-outcomes-title"
        >
          <div class="section-heading">
            <div>
              <p class="eyebrow">Actual FCM network calls</p>
              <h2 id="fcm-outcomes-title">FCM outcomes by platform</h2>
            </div>
            <span class="status-pill">Accepted is not delivered</span>
          </div>
          <tpg-gateway-chart
            [labels]="fcmLabels()"
            [series]="fcmSeries()"
            [stacked]="true"
            accessibleLabel="Stacked Android and iOS FCM outcomes by UTC interval. The following table contains the same values."
            tableCaption="Android and iOS FCM outcomes by UTC interval"
          />
        </section>

        <section
          class="content-panel chart-panel"
          aria-labelledby="latency-title"
        >
          <div class="section-heading">
            <div>
              <p class="eyebrow">Fixed histogram estimate</p>
              <h2 id="latency-title">Approximate p95 FCM latency</h2>
            </div>
            <span class="status-pill">Upper bucket bound</span>
          </div>
          <tpg-gateway-chart
            type="line"
            [labels]="fcmLabels()"
            [series]="latencySeries()"
            valueSuffix=" ms"
            accessibleLabel="Approximate Android and iOS p95 FCM latency by UTC interval. The following table contains the same values."
            tableCaption="Approximate p95 FCM latency by UTC interval"
          />
          <p class="muted">
            10,000 ms represents the open-ended final bucket. “No samples” means
            no actual FCM timing was recorded for that platform and interval.
          </p>
        </section>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricsPage {
  private readonly metricsApi = inject(MetricsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly announcer = inject(StatusAnnouncer);
  private readonly time = inject(TimeService);
  private readonly initialTo = new Date();
  private readonly initialFrom = new Date(
    this.initialTo.getTime() - METRICS_QUERY_POLICY.defaultRangeSeconds * 1_000,
  );

  protected readonly metricsPolicy = METRICS_QUERY_POLICY;
  protected readonly resource = new RemoteResource<Metrics>();
  protected readonly parameters = signal<GetMetricsParams>({
    from: this.initialFrom.toISOString(),
    to: this.initialTo.toISOString(),
    interval: METRICS_QUERY_POLICY.defaultInterval,
  });
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
  protected readonly metrics = computed(() => {
    const state = this.resource.state();
    return state.kind === 'fresh' || state.kind === 'stale'
      ? state.data
      : undefined;
  });
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

  constructor() {
    pollWhileVisible(() =>
      includesCurrentUtcBucket(this.parameters())
        ? from(this.reload())
        : of(undefined),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  protected reload(): Promise<unknown> {
    return this.resource.load(() =>
      this.metricsApi.getMetrics(this.parameters()),
    );
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
