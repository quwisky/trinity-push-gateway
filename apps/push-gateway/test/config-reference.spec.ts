import { describe, expect, it } from 'vitest';

import {
  GATEWAY_CONFIGURATION_REFERENCE,
  type GatewayConfigurationName,
} from '../src/config-reference';
import {
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
    });
  });
});
