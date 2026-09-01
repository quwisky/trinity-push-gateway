import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import type {
  Configuration,
  SecretPresence,
} from '../../api/generated/admin-api.schemas';
import { ConfigurationService } from '../../api/generated/configuration/configuration.service';
import { RemoteResource } from '../../api/remote-resource';
import {
  formatBytes,
  formatCount,
  formatDuration,
  humanizeToken,
} from '../../core/presentation/format';
import { RemoteStatus } from '../../ui/remote-status';

type ConfigurationRow = Readonly<{
  label: string;
  value: string;
  code?: boolean;
}>;

@Component({
  selector: 'tpg-configuration-page',
  imports: [RemoteStatus],
  templateUrl: './configuration.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfigurationPage {
  private readonly configurationApi = inject(ConfigurationService);
  protected readonly resource = new RemoteResource<Configuration>();
  protected readonly configuration = computed(() => {
    const state = this.resource.state();
    return state.kind === 'fresh' || state.kind === 'stale'
      ? state.data
      : undefined;
  });
  protected readonly gatewayRows = computed<readonly ConfigurationRow[]>(() => {
    const gateway = this.configuration()?.gateway;
    if (!gateway) {
      return [];
    }
    return [
      {
        label: 'Android application ID',
        value: gateway.androidApplicationId,
        code: true,
      },
      {
        label: 'iOS application ID',
        value: gateway.iosApplicationId,
        code: true,
      },
      {
        label: 'Firebase project ID',
        value: gateway.firebaseProjectId,
        code: true,
      },
      {
        label: 'Gateway database',
        value: gateway.gatewayDatabasePath,
        code: true,
      },
      { label: 'Maximum body size', value: formatBytes(gateway.maxBodyBytes) },
      {
        label: 'Daily FCM attempt budget',
        value: formatCount(gateway.maxDailyAttempts),
      },
      {
        label: 'Installations per request',
        value: formatCount(gateway.maxClientInstallationsPerRequest),
      },
      {
        label: 'Pending lease',
        value: formatDuration(gateway.pendingLeaseSeconds),
      },
      {
        label: 'Request deadline',
        value: formatDuration(gateway.requestDeadlineSeconds),
      },
      {
        label: 'Terminal retention',
        value: formatDuration(gateway.terminalRetentionSeconds),
      },
      {
        label: 'FCM timeout',
        value: formatDuration(gateway.upstreamTimeoutSeconds),
      },
      {
        label: 'Source rate limit',
        value: `${formatCount(gateway.sourceRateLimit)} per ${formatDuration(gateway.sourceRatePeriodSeconds)}`,
      },
      {
        label: 'Maximum source keys',
        value: formatCount(gateway.maxSourceKeys),
      },
      {
        label: 'Cleanup interval',
        value: formatDuration(gateway.cleanupIntervalSeconds),
      },
    ];
  });
  protected readonly administrationRows = computed<readonly ConfigurationRow[]>(
    () => {
      const administration = this.configuration()?.administration;
      if (!administration) {
        return [];
      }
      return [
        {
          label: 'Administration enabled',
          value: String(administration.enabled),
        },
        {
          label: 'Public origin',
          value: administration.publicOrigin,
          code: true,
        },
        { label: 'OIDC issuer', value: administration.oidcIssuer, code: true },
        {
          label: 'OIDC client ID',
          value: administration.oidcClientId,
          code: true,
        },
        {
          label: 'OIDC scopes',
          value: administration.oidcScopes.join(' '),
          code: true,
        },
        {
          label: 'Required group claim',
          value: administration.oidcGroupClaim,
          code: true,
        },
        {
          label: 'Required group',
          value: administration.oidcRequiredGroup,
          code: true,
        },
        {
          label: 'Token endpoint authentication',
          value: humanizeToken(administration.oidcTokenEndpointAuthMethod),
        },
        {
          label: 'Administration database',
          value: administration.administrationDatabasePath,
          code: true,
        },
        {
          label: 'Backup directory',
          value: administration.backupDirectory,
          code: true,
        },
        {
          label: 'Session idle lifetime',
          value: formatDuration(administration.sessionIdleSeconds),
        },
        {
          label: 'Session absolute lifetime',
          value: formatDuration(administration.sessionAbsoluteSeconds),
        },
        {
          label: 'Sessions per identity',
          value: formatCount(administration.maxSessionsPerIdentity),
        },
        {
          label: 'Deployment sessions',
          value: formatCount(administration.maxSessionsDeployment),
        },
        {
          label: 'Metrics retention',
          value: `${formatCount(administration.metricsRetentionDays)} days`,
        },
        {
          label: 'Audit retention',
          value: `${formatCount(administration.auditRetentionDays)} days`,
        },
        {
          label: 'Firebase validation',
          value: `${formatDuration(administration.firebaseValidationDeadlineSeconds)} deadline · ${formatDuration(administration.firebaseValidationCooldownSeconds)} cooldown`,
        },
        {
          label: 'Cleanup',
          value: `${formatDuration(administration.cleanupDeadlineSeconds)} deadline · ${formatDuration(administration.cleanupCooldownSeconds)} cooldown`,
        },
        {
          label: 'Backup',
          value: `${formatDuration(administration.backupDeadlineSeconds)} deadline · ${formatDuration(administration.backupCooldownSeconds)} cooldown`,
        },
        {
          label: 'Backup count limit',
          value: formatCount(administration.backupLimitCount),
        },
        {
          label: 'Backup byte limit',
          value: formatBytes(administration.backupLimitBytes),
        },
      ];
    },
  );
  protected readonly credentialRows = computed(() => {
    const credentials = this.configuration()?.credentials;
    if (!credentials) {
      return [];
    }
    const rows: readonly Readonly<{
      label: string;
      presence: SecretPresence;
    }>[] = [
      {
        label: 'Firebase client identity',
        presence: credentials.firebaseClientEmail,
      },
      {
        label: 'Firebase private key',
        presence: credentials.firebasePrivateKey,
      },
      { label: 'Firebase project ID', presence: credentials.firebaseProjectId },
      { label: 'Fingerprint key', presence: credentials.fingerprintKey },
      { label: 'OIDC client secret', presence: credentials.oidcClientSecret },
      { label: 'Operator Session secret', presence: credentials.sessionSecret },
    ];
    return rows;
  });
  protected readonly humanizeToken = humanizeToken;

  constructor() {
    void this.reload();
  }

  protected reload(): Promise<unknown> {
    return this.resource.load(() => this.configurationApi.getConfiguration());
  }
}
