import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { DynamicForm, FormConfig } from '@ng-forge/dynamic-forms';
import { standardSchema } from '@ng-forge/dynamic-forms/schema';
import { firstValueFrom } from 'rxjs';
import type {
  AuditEntryKind,
  AuditEntryOutcome,
  ListAuditEntriesParams,
  OperatorAuditEntry,
  OperatorAuditEntryPage,
  OperatorSession,
  OperatorSessionList,
} from '../../api/generated/admin-api.schemas';
import {
  AuditEntryKind as AuditKinds,
  AuditEntryOutcome as AuditOutcomes,
} from '../../api/generated/admin-api.schemas';
import { SecurityService } from '../../api/generated/security/security.service';
import { toSafeApiProblem } from '../../api/api-problem';
import { RemoteResource } from '../../api/remote-resource';
import { OperatorSessionStore } from '../../core/session/operator-session.store';
import { humanizeToken, operatorLabel } from '../../core/presentation/format';
import { TimeService } from '../../core/time/time.service';
import { auditFilterSchema } from '../../core/validation/schemas';
import {
  ConfirmationActionResult,
  ConfirmationDialog,
} from '../../ui/confirmation/confirmation-dialog';
import '../../ui/form/spartan-form.types';
import { HlmButton } from '../../ui/helm/button';
import { RemoteStatus } from '../../ui/remote-status';

const isAuditKind = (value: string): value is AuditEntryKind =>
  Object.values(AuditKinds).some((kind) => kind === value);

const isAuditOutcome = (value: string): value is AuditEntryOutcome =>
  Object.values(AuditOutcomes).some((outcome) => outcome === value);

@Component({
  selector: 'tpg-security-page',
  imports: [ConfirmationDialog, DynamicForm, HlmButton, RemoteStatus],
  template: `
    <header class="page-header">
      <p class="eyebrow">Operator access</p>
      <h1>Security</h1>
      <p class="lede">
        Active Operator Sessions and privacy-safe Operator Audit Entries.
        Identity-provider accounts, groups, and profiles remain outside this UI.
      </p>
    </header>

    <section class="content-panel" aria-labelledby="sessions-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Bounded access</p>
          <h2 id="sessions-title">Active Operator Sessions</h2>
        </div>
        <button
          hlmBtn
          variant="outline"
          size="sm"
          type="button"
          (click)="loadSessions()"
        >
          Refresh
        </button>
      </div>
      <tpg-remote-status
        [state]="sessionResource.state()"
        label="Operator Sessions"
        (retry)="loadSessions()"
      />

      @if (sessions(); as sessionList) {
        <div class="session-list">
          @for (session of sessionList.sessions; track session.id) {
            <article
              class="session-card"
              [class.current-session]="session.current"
            >
              <div>
                <div class="session-title-row">
                  <h3>{{ operatorLabel(session.operator) }}</h3>
                  @if (session.current) {
                    <span class="status-pill">Current session</span>
                  }
                </div>
                <p class="muted">
                  Last seen
                  <time [attr.datetime]="session.lastSeenAt">{{
                    time.format(session.lastSeenAt)
                  }}</time>
                  ({{ time.zoneLabel() }}). Idle expiry
                  <time [attr.datetime]="session.idleExpiresAt">{{
                    time.format(session.idleExpiresAt)
                  }}</time
                  >.
                </p>
              </div>
              <button
                hlmBtn
                variant="destructive"
                size="sm"
                type="button"
                (click)="confirmRevocation(session)"
              >
                {{ session.current ? 'Revoke this session' : 'Revoke session' }}
              </button>
            </article>
          }
        </div>
      }
    </section>

    <section class="content-panel" aria-labelledby="audit-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Privacy-safe history</p>
          <h2 id="audit-title">Operator Audit Entries</h2>
        </div>
        <span class="status-pill">Maximum 90 days</span>
      </div>

      <form
        class="filter-form"
        [dynamic-form]="auditFilterForm"
        (submitted)="applyAuditFilters($event)"
      ></form>
      <tpg-remote-status
        [state]="auditResource.state()"
        label="Operator Audit Entries"
        (retry)="loadAudit(true)"
      />

      @if (auditEntries().length === 0 && auditLoaded()) {
        <div class="empty-state compact-empty">
          <h3>No Operator Audit Entries match</h3>
          <p>The filtered query succeeded and returned no entries.</p>
        </div>
      } @else if (auditEntries().length > 0) {
        <div
          class="table-scroll"
          role="region"
          tabindex="0"
          aria-label="Operator Audit Entries table"
        >
          <table class="data-table">
            <caption>
              Operator Audit Entries in reverse chronological order. Times shown
              in
              {{
                time.zoneLabel()
              }}. No Matrix, notification, address, or raw identity-provider
              data is included.
            </caption>
            <thead>
              <tr>
                <th scope="col">Occurred</th>
                <th scope="col">Kind</th>
                <th scope="col">Outcome</th>
                <th scope="col">Operator Identity</th>
                <th scope="col">Safe reason</th>
              </tr>
            </thead>
            <tbody>
              @for (entry of auditEntries(); track entry.id) {
                <tr>
                  <td>
                    <time [attr.datetime]="entry.occurredAt">{{
                      time.format(entry.occurredAt)
                    }}</time>
                  </td>
                  <td>{{ humanizeToken(entry.kind) }}</td>
                  <td>
                    <span
                      class="outcome-badge"
                      [attr.data-outcome]="entry.outcome"
                      >{{ humanizeToken(entry.outcome) }}</span
                    >
                  </td>
                  <td>{{ operatorLabel(entry.operator) }}</td>
                  <td>
                    {{ entry.reason ? humanizeToken(entry.reason) : 'None' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (nextCursor()) {
          <button
            class="load-more"
            hlmBtn
            variant="outline"
            type="button"
            (click)="loadAudit(false)"
          >
            Load older entries
          </button>
        }
      }
    </section>
    <tpg-confirmation-dialog />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecurityPage {
  private readonly securityApi = inject(SecurityService);
  private readonly sessionStore = inject(OperatorSessionStore);
  private readonly router = inject(Router);
  private readonly dialog = viewChild.required(ConfirmationDialog);
  private readonly initialTo = new Date();
  private readonly initialFrom = new Date(
    this.initialTo.getTime() - 86_400_000,
  );

  protected readonly time = inject(TimeService);
  protected readonly sessionResource =
    new RemoteResource<OperatorSessionList>();
  protected readonly auditResource =
    new RemoteResource<OperatorAuditEntryPage>();
  protected readonly auditEntries = signal<readonly OperatorAuditEntry[]>([]);
  protected readonly nextCursor = signal<string | undefined>(undefined);
  protected readonly auditLoaded = signal(false);
  protected readonly auditParameters = signal<ListAuditEntriesParams>({
    from: this.initialFrom.toISOString(),
    to: this.initialTo.toISOString(),
    limit: 50,
  });
  protected readonly sessions = computed(() => {
    const state = this.sessionResource.state();
    return state.kind === 'fresh' || state.kind === 'stale'
      ? state.data
      : undefined;
  });
  protected readonly auditFilterForm = {
    fields: [
      {
        key: 'from',
        type: 'datetime',
        value: this.time.toDateTimeLocal(this.initialFrom),
        label: 'From',
      },
      {
        key: 'to',
        type: 'datetime',
        value: this.time.toDateTimeLocal(this.initialTo),
        label: 'To',
      },
      {
        key: 'kind',
        type: 'select',
        value: 'all',
        label: 'Kind',
        options: [
          { value: 'all', label: 'All kinds' },
          ...Object.values(AuditKinds).map((value) => ({
            value,
            label: humanizeToken(value),
          })),
        ],
      },
      {
        key: 'outcome',
        type: 'select',
        value: 'all',
        label: 'Outcome',
        options: [
          { value: 'all', label: 'All outcomes' },
          ...Object.values(AuditOutcomes).map((value) => ({
            value,
            label: humanizeToken(value),
          })),
        ],
      },
      { key: 'apply', type: 'submit', label: 'Apply audit filters' },
    ],
    schema: standardSchema(auditFilterSchema),
    options: { idPrefix: 'audit-filter' },
  } as const satisfies FormConfig;
  protected readonly humanizeToken = humanizeToken;
  protected readonly operatorLabel = operatorLabel;

  constructor() {
    void Promise.all([this.loadSessions(), this.loadAudit(true)]);
  }

  protected loadSessions(): Promise<unknown> {
    return this.sessionResource.load(() => this.securityApi.listSessions());
  }

  protected async loadAudit(reset: boolean): Promise<void> {
    const cursor = reset ? undefined : this.nextCursor();
    if (!reset && !cursor) {
      return;
    }
    const state = await this.auditResource.load(() =>
      this.securityApi.listAuditEntries({
        ...this.auditParameters(),
        ...(cursor ? { cursor } : {}),
      }),
    );
    if (state.kind !== 'fresh') {
      return;
    }
    this.auditEntries.update((entries) =>
      reset ? state.data.entries : [...entries, ...state.data.entries],
    );
    this.nextCursor.set(state.data.nextCursor);
    this.auditLoaded.set(true);
  }

  protected async applyAuditFilters(
    value: Readonly<{
      from?: string;
      to?: string;
      kind?: string;
      outcome?: string;
    }>,
  ): Promise<void> {
    if (
      typeof value.from !== 'string' ||
      typeof value.to !== 'string' ||
      typeof value.kind !== 'string' ||
      typeof value.outcome !== 'string'
    ) {
      return;
    }
    if (
      (value.kind !== 'all' && !isAuditKind(value.kind)) ||
      (value.outcome !== 'all' && !isAuditOutcome(value.outcome))
    ) {
      return;
    }
    const from = this.time.fromDateTimeLocal(value.from);
    const to = this.time.fromDateTimeLocal(value.to);
    if (!from || !to) {
      return;
    }
    this.auditParameters.set({
      from,
      to,
      limit: 50,
      ...(value.kind === 'all' ? {} : { kind: value.kind }),
      ...(value.outcome === 'all' ? {} : { outcome: value.outcome }),
    });
    this.auditEntries.set([]);
    this.nextCursor.set(undefined);
    this.auditLoaded.set(false);
    await this.loadAudit(true);
  }

  protected async confirmRevocation(session: OperatorSession): Promise<void> {
    const revoked = await this.dialog().open({
      title: session.current
        ? 'Revoke this Operator Session'
        : 'Revoke Operator Session',
      description: session.current
        ? 'This immediately ends the current Operator Session and returns this browser to sign in.'
        : `This immediately ends the selected Operator Session for ${operatorLabel(session.operator)}.`,
      confirmationLabel:
        'I understand this session will stop working immediately.',
      pendingLabel: 'Revoking Operator Session…',
      action: () => this.revokeSession(session),
    });
    if (revoked && session.current) {
      this.sessionStore.clear();
      await this.router.navigate(['/sign-in'], {
        queryParams: { reason: 'unauthenticated' },
      });
    }
  }

  private async revokeSession(
    session: OperatorSession,
  ): Promise<ConfirmationActionResult> {
    try {
      await firstValueFrom(this.securityApi.revokeSession(session.id));
      if (!session.current) {
        await this.loadSessions();
      }
      return {
        succeeded: true,
        message: session.current
          ? 'This Operator Session was revoked.'
          : 'The selected Operator Session was revoked.',
      };
    } catch (error) {
      const problem = toSafeApiProblem(error);
      return {
        succeeded: false,
        message: problem.detail
          ? `${problem.title} ${problem.detail}`
          : problem.title,
      };
    }
  }
}
