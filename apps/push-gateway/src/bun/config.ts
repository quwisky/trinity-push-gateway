import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  loadBunRuntimeConfiguration,
  type BunRuntimeConfiguration,
} from '../configuration-catalog/bun';
import { trustedProxyConfigurationValid } from './client-address';
import {
  loadAdminConfiguration,
  type AdminConfigurationState,
} from './admin/config';

export type {
  ClientIpHeader,
  CredentialSource,
  GatewayCredentialSources,
} from '../configuration-catalog/bun';

export type BunConfiguration = BunRuntimeConfiguration &
  Readonly<{ administration: AdminConfigurationState }>;

type Environment = Readonly<Record<string, string | undefined>>;

export function loadBunConfiguration(
  environment: Environment,
): BunConfiguration {
  const runtime = loadBunRuntimeConfiguration(environment, {
    readFile: (filePath) => readFileSync(filePath, 'utf8'),
    trustedProxyConfigurationValid,
  });
  const loadedAdministration = loadAdminConfiguration(environment);
  const administration =
    loadedAdministration.kind === 'enabled' &&
    path.resolve(loadedAdministration.configuration.databasePath) ===
      path.resolve(runtime.databasePath)
      ? ({ kind: 'invalid' } as const)
      : loadedAdministration;

  return { ...runtime, administration };
}
