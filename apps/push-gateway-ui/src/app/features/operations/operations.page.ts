import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  BackupList,
  OperationSummary,
  Overview,
} from '../../api/generated/admin-api.schemas';
import { OperationsService } from '../../api/generated/operations/operations.service';
import { OverviewService } from '../../api/generated/overview/overview.service';
import { toSafeApiProblem } from '../../api/api-problem';
import { RemoteResource } from '../../api/remote-resource';
import {
  formatBytes,
  humanizeToken,
  operatorLabel,
} from '../../core/presentation/format';
import { TimeService } from '../../core/time/time.service';
import {
  ConfirmationActionResult,
  ConfirmationDialog,
  ConfirmationRequest,
} from '../../ui/confirmation/confirmation-dialog';
import { HlmButton } from '../../ui/helm/button';
import { RemoteStatus } from '../../ui/remote-status';

type ActionKind = 'firebase' | 'cleanup' | 'backup';

const actionCopy: Record<
  ActionKind,
  Omit<ConfirmationRequest, 'action'> & { success: string }
> = {
  firebase: {
    title: 'Validate Firebase access',
    description:
      'Run a validate-only credential, project, and FCM API access check. It uses a synthetic non-deliverable target and is not an end-to-end delivery test. Deadline: 20 seconds. Cooldown: 1 minute.',
    confirmationLabel:
      'I understand this validates Firebase access but does not prove delivery.',
    pendingLabel: 'Validating Firebase access (up to 20 seconds)…',
    success: 'Firebase access validation succeeded.',
  },
  cleanup: {
    title: 'Run gateway cleanup',
    description:
      'Run the fixed retention cleanup in an isolated child process. Notification delivery remains independent. Deadline: 30 seconds. Cooldown: 5 minutes.',
    confirmationLabel: 'I understand this starts the fixed cleanup operation.',
    pendingLabel: 'Running gateway cleanup (up to 30 seconds)…',
    success: 'Gateway cleanup succeeded.',
  },
  backup: {
    title: 'Create verified gateway backup',
    description:
      'Create one integrity-verified gateway.sqlite backup with a generated name. The action never overwrites or auto-deletes a backup. Deadline: 120 seconds. Cooldown: 1 hour.',
    confirmationLabel:
      'I understand this creates one verified gateway database backup.',
    pendingLabel: 'Creating and verifying the backup (up to 120 seconds)…',
    success: 'Verified gateway backup created.',
  },
};

@Component({
  selector: 'tpg-operations-page',
  imports: [ConfirmationDialog, HlmButton, RemoteStatus],
  templateUrl: './operations.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperationsPage {
  private readonly operationsApi = inject(OperationsService);
  private readonly overviewApi = inject(OverviewService);
  private readonly dialog = viewChild.required(ConfirmationDialog);

  protected readonly time = inject(TimeService);
  protected readonly overviewResource = new RemoteResource<Overview>();
  protected readonly backupResource = new RemoteResource<BackupList>();
  protected readonly lastActionMessage = signal('');
  protected readonly overview = computed(() => {
    const state = this.overviewResource.state();
    return state.kind === 'fresh' || state.kind === 'stale'
      ? state.data
      : undefined;
  });
  protected readonly backups = computed(() => {
    const state = this.backupResource.state();
    return state.kind === 'fresh' || state.kind === 'stale'
      ? state.data
      : undefined;
  });
  protected readonly formatBytes = formatBytes;
  protected readonly humanizeToken = humanizeToken;
  protected readonly operatorLabel = operatorLabel;

  constructor() {
    void this.reload();
  }

  protected async reload(): Promise<void> {
    await Promise.all([
      this.overviewResource.load(() => this.overviewApi.getOverview()),
      this.loadBackups(),
    ]);
  }

  protected loadBackups(): Promise<unknown> {
    return this.backupResource.load(() => this.operationsApi.listBackups());
  }

  protected async confirm(kind: ActionKind): Promise<void> {
    const copy = actionCopy[kind];
    await this.dialog().open({
      ...copy,
      action: () => this.execute(kind, copy.success),
    });
  }

  protected summaryText(summary: OperationSummary | undefined): string {
    if (!summary) {
      return 'No recorded action. The button is available.';
    }
    const reason = summary.reason ? ` · ${humanizeToken(summary.reason)}` : '';
    return `Last ${humanizeToken(summary.outcome)} ${this.time.format(summary.completedAt)} · cooldown ends ${this.time.format(summary.cooldownEndsAt)}${reason}`;
  }

  private async execute(
    kind: ActionKind,
    successMessage: string,
  ): Promise<ConfirmationActionResult> {
    try {
      const result =
        kind === 'firebase'
          ? await firstValueFrom(this.operationsApi.validateFirebase())
          : kind === 'cleanup'
            ? await firstValueFrom(this.operationsApi.runCleanup())
            : await firstValueFrom(this.operationsApi.createBackup());
      if ('outcome' in result && result.outcome === 'failed') {
        const message = result.reason
          ? `${humanizeToken(result.reason)}. The known action result was failed.`
          : 'The known action result was failed.';
        return { succeeded: false, message };
      }
      this.lastActionMessage.set(successMessage);
      await Promise.all([
        this.overviewResource.load(() => this.overviewApi.getOverview()),
        kind === 'backup' ? this.loadBackups() : Promise.resolve(),
      ]);
      return { succeeded: true, message: successMessage };
    } catch (error) {
      const problem = toSafeApiProblem(error);
      const message = problem.detail
        ? `${problem.title} ${problem.detail}`
        : problem.title;
      return { succeeded: false, message };
    }
  }
}
