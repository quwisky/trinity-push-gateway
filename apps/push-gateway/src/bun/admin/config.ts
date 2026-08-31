import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  loadAdministrationConfiguration,
  type AdminConfigurationState,
} from '../../configuration-catalog/administration';

export {
  ADMIN_CONFIGURATION_ENVIRONMENT_NAMES,
  type AdminConfiguration,
  type AdminConfigurationEnvironmentName,
  type AdminConfigurationState,
  type AdministrationPolicy,
  type AdminSecret,
  type SafeAdminConfiguration,
} from '../../configuration-catalog/administration';

type Environment = Readonly<Record<string, string | undefined>>;

type LoadAdminConfigurationOptions = Readonly<{
  readFile?: (path: string) => string;
}>;

export function loadAdminConfiguration(
  environment: Environment,
  options: LoadAdminConfigurationOptions = {},
): AdminConfigurationState {
  return loadAdministrationConfiguration(environment, {
    readFile: options.readFile ?? ((path) => readFileSync(path, 'utf8')),
    sha256: (value) => createHash('sha256').update(value).digest('hex'),
  });
}
