import {
  loadSharedRuntimeConfiguration,
  type RuntimeConfig,
  type SharedConfigurationEnvironment,
} from './configuration-catalog/shared';

export {
  CONFIGURATION_ENVIRONMENT_NAMES,
  type ConfigurationEnvironmentName,
  type RuntimeConfig,
  type SharedConfigurationEnvironment as ConfigurationEnvironment,
} from './configuration-catalog/shared';

export function runtimeConfig(
  environment: SharedConfigurationEnvironment,
): RuntimeConfig | undefined {
  return loadSharedRuntimeConfiguration(environment);
}
