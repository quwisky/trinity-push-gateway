import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import type { Configuration } from '../../api/generated/admin-api.schemas';
import { ConfigurationService } from '../../api/generated/configuration/configuration.service';
import { ConfigurationPage } from './configuration.page';

const CONFIGURATION = {
  observedAt: '2026-08-31T12:00:00Z',
  version: '0.8.0-test',
  gateway: {
    androidApplicationId: 'ovh.qwky.trinity.android',
    cleanupIntervalSeconds: 86_400,
    firebaseProjectId: 'trinity-test',
    gatewayDatabasePath: '/data/gateway.sqlite',
    iosApplicationId: 'ovh.qwky.trinity.ios',
    maxBodyBytes: 65_536,
    maxClientInstallationsPerRequest: 49,
    maxDailyAttempts: 20_000,
    maxSourceKeys: 10_000,
    pendingLeaseSeconds: 120,
    requestDeadlineSeconds: 30,
    sourceRateLimit: 300,
    sourceRatePeriodSeconds: 10,
    terminalRetentionSeconds: 86_400,
    upstreamTimeoutSeconds: 10,
  },
  administration: {
    administrationDatabasePath: '/data/admin.sqlite',
    auditRetentionDays: 90,
    backupCooldownSeconds: 3_600,
    backupDeadlineSeconds: 120,
    backupDirectory: '/data/backups',
    backupLimitBytes: 1_073_741_824,
    backupLimitCount: 24,
    cleanupCooldownSeconds: 300,
    cleanupDeadlineSeconds: 30,
    enabled: true,
    firebaseValidationCooldownSeconds: 60,
    firebaseValidationDeadlineSeconds: 20,
    maxSessionsDeployment: 100,
    maxSessionsPerIdentity: 5,
    metricsRetentionDays: 30,
    oidcClientId: 'gateway-client',
    oidcGroupClaim: 'groups',
    oidcIssuer: 'https://identity.example/',
    oidcRequiredGroup: 'gateway-operators',
    oidcScopes: ['openid', 'profile', 'email', 'groups'],
    oidcTokenEndpointAuthMethod: 'client_secret_basic',
    publicOrigin: 'https://gateway.example',
    sessionAbsoluteSeconds: 28_800,
    sessionIdleSeconds: 1_800,
  },
  credentials: {
    firebaseClientEmail: { configured: true, source: 'file' },
    firebasePrivateKey: { configured: true, source: 'file' },
    firebaseProjectId: { configured: true, source: 'file' },
    fingerprintKey: { configured: true, source: 'file' },
    oidcClientSecret: { configured: true, source: 'file' },
    sessionSecret: { configured: true, source: 'file' },
  },
} as const satisfies Configuration;

describe('ConfigurationPage', () => {
  it('presents the catalog-backed safe runtime projection', async () => {
    await TestBed.configureTestingModule({
      imports: [ConfigurationPage],
      providers: [
        {
          provide: ConfigurationService,
          useValue: { getConfiguration: () => of(CONFIGURATION) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ConfigurationPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    const rows = Array.from(page.querySelectorAll('tbody tr'));
    const sessionSecret = rows.find((row) =>
      row.textContent.includes('Operator Session secret'),
    );
    const administrationEnabled = Array.from(
      page.querySelectorAll('.configuration-list > div'),
    ).find((row) => row.textContent.includes('Administration enabled'));

    expect(administrationEnabled?.textContent).toContain('true');
    expect(sessionSecret?.textContent).toContain('Yes');
    expect(sessionSecret?.textContent).toContain('File');
    expect(page.textContent).toContain('ovh.qwky.trinity.android');
    expect(page.textContent).toContain('/data/gateway.sqlite');
    expect(page.textContent).toContain('https://identity.example/');
    expect(page.textContent).not.toContain('oidc-client-secret');
  });
});
