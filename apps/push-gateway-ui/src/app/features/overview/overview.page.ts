import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { from } from 'rxjs';
import type {
  OperationSummary,
  Overview,
  RequestOutcomeCounts,
} from '../../api/generated/admin-api.schemas';
import { OverviewService } from '../../api/generated/overview/overview.service';
import { RemoteResource } from '../../api/remote-resource';
import {
  formatBytes,
  formatCount,
  formatDuration,
  humanizeToken,
} from '../../core/presentation/format';
import { pollWhileVisible } from '../../core/polling/visibility-poller';
import { TimeService } from '../../core/time/time.service';
import { RemoteStatus } from '../../ui/remote-status';

const requestTotal = (counts: RequestOutcomeCounts): number =>
  counts.processed +
  counts.invalid +
  counts.rateLimited +
  counts.safetyBudgetExhausted +
  counts.storageUnavailable;

@Component({
  selector: 'tpg-overview-page',
  imports: [RemoteStatus],
  template: `
    <header class="page-header">
      <p class="eyebrow">Deployment</p>
      <h1>Overview</h1>
      <p class="lede">
        A privacy-preserving summary of readiness, storage, and the last 24
        hours. Accepted by FCM does not mean delivered to a Client Installation.
      </p>
      <tpg-remote-status
        [state]="resource.state()"
        label="overview"
        (retry)="reload()"
      />
    </header>

    @if (overview(); as data) {
      <section class="panel-grid" aria-label="Deployment status">
        <article class="status-card">
          <span class="status-label">Gateway delivery</span>
          <strong [class.status-good]="data.gatewayReady">
            {{ data.gatewayReady ? 'Ready' : 'Not ready' }}
          </strong>
          <p>Observed independently without probing delivery storage.</p>
        </article>
        <article class="status-card">
          <span class="status-label">Administration</span>
          <strong [class.status-good]="data.administrationReady">
            {{ data.administrationReady ? 'Ready' : 'Not ready' }}
          </strong>
          <p>The authenticated request reached isolated administration.</p>
        </article>
        <article class="status-card">
          <span class="status-label">Running version</span>
          <strong>{{ data.version }}</strong>
          <p>Uptime {{ formatDuration(data.uptimeSeconds) }}.</p>
        </article>
      </section>

      <section class="content-grid two-columns" aria-label="24-hour totals">
        <article class="content-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Last 24 hours</p>
              <h2>Notification Requests</h2>
            </div>
            <strong class="metric-total">{{
              formatCount(requestsTotal())
            }}</strong>
          </div>
          <dl class="metric-list">
            <div>
              <dt>Processed</dt>
              <dd>{{ formatCount(data.requestsLast24Hours.processed) }}</dd>
            </div>
            <div>
              <dt>Invalid</dt>
              <dd>{{ formatCount(data.requestsLast24Hours.invalid) }}</dd>
            </div>
            <div>
              <dt>Rate limited</dt>
              <dd>{{ formatCount(data.requestsLast24Hours.rateLimited) }}</dd>
            </div>
            <div>
              <dt>Safety budget exhausted</dt>
              <dd>
                {{
                  formatCount(data.requestsLast24Hours.safetyBudgetExhausted)
                }}
              </dd>
            </div>
            <div>
              <dt>Storage unavailable</dt>
              <dd>
                {{ formatCount(data.requestsLast24Hours.storageUnavailable) }}
              </dd>
            </div>
          </dl>
        </article>

        <article class="content-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Actual network calls</p>
              <h2>FCM attempts</h2>
            </div>
            <strong class="metric-total">{{ formatCount(fcmTotal()) }}</strong>
          </div>
          <div class="platform-grid">
            <section aria-labelledby="android-total-title">
              <h3 id="android-total-title">Android</h3>
              <dl class="metric-list compact-list">
                <div>
                  <dt>Accepted</dt>
                  <dd>
                    {{
                      formatCount(data.fcmAttemptsLast24Hours.android.accepted)
                    }}
                  </dd>
                </div>
                <div>
                  <dt>Permanently rejected</dt>
                  <dd>
                    {{
                      formatCount(
                        data.fcmAttemptsLast24Hours.android.permanentlyRejected
                      )
                    }}
                  </dd>
                </div>
                <div>
                  <dt>Transient failure</dt>
                  <dd>
                    {{
                      formatCount(
                        data.fcmAttemptsLast24Hours.android.transientFailure
                      )
                    }}
                  </dd>
                </div>
              </dl>
            </section>
            <section aria-labelledby="ios-total-title">
              <h3 id="ios-total-title">iOS</h3>
              <dl class="metric-list compact-list">
                <div>
                  <dt>Accepted</dt>
                  <dd>
                    {{ formatCount(data.fcmAttemptsLast24Hours.ios.accepted) }}
                  </dd>
                </div>
                <div>
                  <dt>Permanently rejected</dt>
                  <dd>
                    {{
                      formatCount(
                        data.fcmAttemptsLast24Hours.ios.permanentlyRejected
                      )
                    }}
                  </dd>
                </div>
                <div>
                  <dt>Transient failure</dt>
                  <dd>
                    {{
                      formatCount(
                        data.fcmAttemptsLast24Hours.ios.transientFailure
                      )
                    }}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </article>
      </section>

      <section
        class="content-grid two-columns"
        aria-label="Storage and recent actions"
      >
        <article class="content-panel">
          <p class="eyebrow">Bounded storage</p>
          <h2>Database usage</h2>
          <dl class="metric-list">
            <div>
              <dt>Gateway</dt>
              <dd>{{ formatBytes(data.databaseBytes.gateway) }}</dd>
            </div>
            <div>
              <dt>Administration</dt>
              <dd>{{ formatBytes(data.databaseBytes.administration) }}</dd>
            </div>
          </dl>
        </article>
        <article class="content-panel">
          <p class="eyebrow">Most recent results</p>
          <h2>Operator Actions</h2>
          <dl class="operation-summary-list">
            <div>
              <dt>Cleanup</dt>
              <dd>{{ operationText(data.lastCleanup) }}</dd>
            </div>
            <div>
              <dt>Verified backup</dt>
              <dd>{{ operationText(data.lastBackup) }}</dd>
            </div>
            <div>
              <dt>Firebase validation</dt>
              <dd>{{ operationText(data.lastFirebaseValidation) }}</dd>
            </div>
          </dl>
          <p class="muted timestamp-note">
            Times shown in {{ time.zoneLabel() }}.
          </p>
        </article>
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewPage {
  private readonly overviewApi = inject(OverviewService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly time = inject(TimeService);
  protected readonly resource = new RemoteResource<Overview>();
  protected readonly overview = computed(() => {
    const state = this.resource.state();
    return state.kind === 'fresh' || state.kind === 'stale'
      ? state.data
      : undefined;
  });
  protected readonly requestsTotal = computed(() => {
    const overview = this.overview();
    return overview ? requestTotal(overview.requestsLast24Hours) : 0;
  });
  protected readonly fcmTotal = computed(() => {
    const overview = this.overview();
    return overview
      ? overview.fcmAttemptsLast24Hours.android.attempted +
          overview.fcmAttemptsLast24Hours.ios.attempted
      : 0;
  });
  protected readonly formatBytes = formatBytes;
  protected readonly formatCount = formatCount;
  protected readonly formatDuration = formatDuration;

  constructor() {
    pollWhileVisible(() => from(this.reload()))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  protected reload(): Promise<unknown> {
    return this.resource.load(() => this.overviewApi.getOverview());
  }

  protected operationText(operation: OperationSummary | undefined): string {
    if (!operation) {
      return 'No recorded action';
    }
    const reason = operation.reason
      ? ` · ${humanizeToken(operation.reason)}`
      : '';
    return `${humanizeToken(operation.outcome)} · ${this.time.format(operation.completedAt)}${reason}`;
  }
}
