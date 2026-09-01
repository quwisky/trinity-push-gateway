import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import type {
  OperationSummary,
  Overview,
  RequestOutcomeCounts,
} from '../../api/generated/admin-api.schemas';
import { OverviewService } from '../../api/generated/overview/overview.service';
import {
  formatBytes,
  formatCount,
  formatDuration,
  humanizeToken,
} from '../../core/presentation/format';
import { RemoteQuery } from '../../core/remote-state/remote-query';
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
  templateUrl: './overview.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewPage {
  private readonly overviewApi = inject(OverviewService);
  protected readonly time = inject(TimeService);
  protected readonly remote = new RemoteQuery<Overview>(() =>
    this.overviewApi.getOverview(),
  );
  protected readonly overview = this.remote.data;
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

  protected reload(): Promise<unknown> {
    return this.remote.refresh();
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
