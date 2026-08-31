import { describe, expect, it } from 'vitest';

import {
  GATEWAY_CONFIGURATION_REFERENCE,
  type GatewayConfigurationName,
} from '../src/config-reference';
import { ADMIN_CONFIGURATION_ENVIRONMENT_NAMES } from '../src/admin-configuration-names';
import { PUSH_GATEWAY_CONFIGURATION_CATALOG } from '../src/configuration-catalog';
import {
  ADMIN_CONFIGURATION_DEFAULTS,
  BUN_CONFIGURATION_DEFAULTS,
  SHARED_CONFIGURATION_DEFAULTS,
} from '../src/configuration-defaults';
import { CONFIGURATION_ENVIRONMENT_NAMES } from '../src/config';

describe('gateway configuration reference', () => {
  it('covers every shared runtime input exactly once', () => {
    const names = GATEWAY_CONFIGURATION_REFERENCE.map(({ name }) => name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([...CONFIGURATION_ENVIRONMENT_NAMES]),
    );
    for (const name of CONFIGURATION_ENVIRONMENT_NAMES) {
      expect(
        GATEWAY_CONFIGURATION_REFERENCE.find((entry) => entry.name === name),
      ).toMatchObject({ runtimes: ['cloudflare', 'bun'] });
    }
  });

  it('marks credentials as secrets and documents their Bun file alternatives', () => {
    const credentialNames = [
      'TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL',
      'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY',
      'TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID',
      'TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY',
    ] as const satisfies readonly GatewayConfigurationName[];

    for (const name of credentialNames) {
      expect(
        GATEWAY_CONFIGURATION_REFERENCE.find((entry) => entry.name === name),
      ).toMatchObject({ required: true, secret: true });
      expect(
        GATEWAY_CONFIGURATION_REFERENCE.find(
          (entry) => entry.name === `${name}_FILE`,
        ),
      ).toMatchObject({ runtimes: ['bun'], secret: true });
    }
  });

  it('covers every Bun administration input exactly once', () => {
    const names = GATEWAY_CONFIGURATION_REFERENCE.map(({ name }) => name);

    expect(names).toEqual(
      expect.arrayContaining([...ADMIN_CONFIGURATION_ENVIRONMENT_NAMES]),
    );
    for (const name of ADMIN_CONFIGURATION_ENVIRONMENT_NAMES) {
      expect(
        GATEWAY_CONFIGURATION_REFERENCE.find((entry) => entry.name === name),
      ).toMatchObject({ required: false, runtimes: ['bun'] });
    }
  });

  it('marks administration credentials and file alternatives as secrets', () => {
    const secretPairs = [
      [
        'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET',
        'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET_FILE',
      ],
      [
        'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET',
        'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE',
      ],
    ] as const satisfies readonly (readonly [
      GatewayConfigurationName,
      GatewayConfigurationName,
    ])[];

    for (const pair of secretPairs) {
      for (const name of pair) {
        expect(
          GATEWAY_CONFIGURATION_REFERENCE.find((entry) => entry.name === name),
        ).toMatchObject({ required: false, runtimes: ['bun'], secret: true });
      }
    }
  });

  it('publishes catalog-owned administration metadata without secret values', () => {
    const catalogNames = [
      'TRINITY_PUSH_GATEWAY_ADMIN_ENABLED',
      'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET',
      'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE',
    ] as const;

    for (const name of catalogNames) {
      expect(
        GATEWAY_CONFIGURATION_REFERENCE.find((entry) => entry.name === name),
      ).toEqual(PUSH_GATEWAY_CONFIGURATION_CATALOG.reference(name));
    }
  });

  it('keeps documented defaults aligned with the runtime contract', () => {
    const defaults = Object.fromEntries(
      GATEWAY_CONFIGURATION_REFERENCE.map(({ defaultValue, name }) => [
        name,
        defaultValue,
      ]),
    );

    expect(defaults).toMatchObject({
      ...SHARED_CONFIGURATION_DEFAULTS,
      ...BUN_CONFIGURATION_DEFAULTS,
      ...ADMIN_CONFIGURATION_DEFAULTS,
    });
  });
});
