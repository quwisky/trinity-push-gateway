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
  template: `
    <header class="page-header">
      <p class="eyebrow">Bounded actions</p>
      <h1>Operations</h1>
      <p class="lede">
        Run three synchronous Operator Actions without general process,
        filesystem, configuration, or database access.
      </p>
      <tpg-remote-status
        [state]="overviewResource.state()"
        label="operation status"
        (retry)="reload()"
      />
    </header>

    <section
      class="operation-card-grid"
      aria-label="Available Operator Actions"
    >
      <article class="operation-card">
        <p class="eyebrow">Credential and API check</p>
        <h2>Firebase validation</h2>
        <p>
          Validates configured credentials, project, and FCM API access with
          <code>validate_only</code>. It sends no Delivery Message.
        </p>
        <dl class="inline-facts">
          <div>
            <dt>Deadline</dt>
            <dd>20 seconds</dd>
          </div>
          <div>
            <dt>Cooldown</dt>
            <dd>1 minute</dd>
          </div>
        </dl>
        <p class="operation-last">
          {{ summaryText(overview()?.lastFirebaseValidation) }}
        </p>
        <button hlmBtn type="button" (click)="confirm('firebase')">
          Validate Firebase access
        </button>
      </article>

      <article class="operation-card">
        <p class="eyebrow">Fixed retention</p>
        <h2>Gateway cleanup</h2>
        <p>
          Reclaims eligible delivery state in an isolated child process. It has
          no user-supplied database or retention parameter.
        </p>
        <dl class="inline-facts">
          <div>
            <dt>Deadline</dt>
            <dd>30 seconds</dd>
          </div>
          <div>
            <dt>Cooldown</dt>
            <dd>5 minutes</dd>
          </div>
        </dl>
        <p class="operation-last">{{ summaryText(overview()?.lastCleanup) }}</p>
        <button hlmBtn type="button" (click)="confirm('cleanup')">
          Run cleanup
        </button>
      </article>

      <article class="operation-card">
        <p class="eyebrow">Local durable copy</p>
        <h2>Verified gateway backup</h2>
        <p>
          Creates a generated, integrity-verified backup without overwrite,
          download, restore, deletion, or path selection.
        </p>
        <dl class="inline-facts">
          <div>
            <dt>Deadline</dt>
            <dd>120 seconds</dd>
          </div>
          <div>
            <dt>Cooldown</dt>
            <dd>1 hour</dd>
          </div>
        </dl>
        <p class="operation-last">{{ summaryText(overview()?.lastBackup) }}</p>
        <button hlmBtn type="button" (click)="confirm('backup')">
          Create verified backup
        </button>
      </article>
    </section>

    @if (lastActionMessage(); as message) {
      <p class="success-message action-result" role="status">{{ message }}</p>
    }

    <section class="content-panel" aria-labelledby="backup-list-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Metadata only</p>
          <h2 id="backup-list-title">Verified backups</h2>
        </div>
        <button
          hlmBtn
          variant="outline"
          size="sm"
          type="button"
          (click)="loadBackups()"
        >
          Refresh
        </button>
      </div>
      <tpg-remote-status
        [state]="backupResource.state()"
        label="backup metadata"
        (retry)="loadBackups()"
      />

      @if (backups(); as backupList) {
        @if (backupList.backups.length === 0) {
          <div class="empty-state compact-empty">
            <h3>No verified backups recorded</h3>
            <p>
              The metadata query succeeded. Create a backup when one is needed.
            </p>
          </div>
        } @else {
          <div
            class="table-scroll"
            role="region"
            tabindex="0"
            aria-label="Verified backup metadata table"
          >
            <table class="data-table">
              <caption>
                Verified gateway backup metadata. Times shown in
                {{
                  time.zoneLabel()
                }}.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Generated name</th>
                  <th scope="col">Created</th>
                  <th scope="col">Size</th>
                  <th scope="col">Integrity</th>
                  <th scope="col">Requested by</th>
                  <th scope="col">SHA-256</th>
                </tr>
              </thead>
              <tbody>
                @for (backup of backupList.backups; track backup.id) {
                  <tr>
                    <th scope="row">
                      <code>{{ backup.name }}</code>
                    </th>
                    <td>
                      <time [attr.datetime]="backup.createdAt">{{
                        time.format(backup.createdAt)
                      }}</time>
                    </td>
                    <td>{{ formatBytes(backup.sizeBytes) }}</td>
                    <td>{{ humanizeToken(backup.integrity) }}</td>
                    <td>{{ operatorLabel(backup.operator) }}</td>
                    <td>
                      <code class="checksum">{{ backup.sha256 }}</code>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </section>
    <tpg-confirmation-dialog />
  `,
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
