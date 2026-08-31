import { ADMINISTRATION_CONFIGURATION_DEFINITIONS } from './configuration-catalog/administration';
import { BUN_CONFIGURATION_DEFINITIONS } from './configuration-catalog/bun';
import { COMPOSE_CONFIGURATION_DEFINITIONS } from './configuration-catalog/compose';
import { SHARED_CONFIGURATION_DEFINITIONS } from './configuration-catalog/shared';
import type { ConfigurationCatalogReference } from './configuration-catalog/types';

export {
  ADMIN_CONFIGURATION_DEFAULTS,
  ADMIN_CONFIGURATION_ENVIRONMENT_NAMES,
  ADMIN_POLICY_DEFAULTS,
  loadAdministrationConfiguration,
  type AdminConfiguration,
  type AdminConfigurationEnvironmentName,
  type AdminConfigurationState,
  type AdministrationPolicy,
  type AdminSecret,
  type SafeAdminConfiguration,
} from './configuration-catalog/administration';
export {
  BUN_CONFIGURATION_DEFAULTS,
  loadBunRuntimeConfiguration,
  type BunRuntimeConfiguration,
  type ClientIpHeader,
  type CredentialSource,
  type GatewayCredentialSources,
  type SafeBunRuntimeConfiguration,
} from './configuration-catalog/bun';
export { COMPOSE_CONFIGURATION_DEFAULTS } from './configuration-catalog/compose';
export {
  CONFIGURATION_ENVIRONMENT_NAMES,
  loadSharedRuntimeConfiguration,
  SHARED_CONFIGURATION_DEFAULTS,
  type ConfigurationEnvironmentName,
  type RuntimeConfig,
  type SharedConfigurationEnvironment,
} from './configuration-catalog/shared';
export type {
  CatalogSecret,
  ConfigurationCatalogReference,
  ConfigurationEnvironment,
  ConfigurationRuntime,
} from './configuration-catalog/types';

const CONFIGURATION_DEFINITIONS = Object.freeze([
  ...SHARED_CONFIGURATION_DEFINITIONS,
  ...BUN_CONFIGURATION_DEFINITIONS,
  ...ADMINISTRATION_CONFIGURATION_DEFINITIONS,
  ...COMPOSE_CONFIGURATION_DEFINITIONS,
]);

export type GatewayConfigurationName =
  (typeof CONFIGURATION_DEFINITIONS)[number]['name'];
export type GatewayConfigurationReferenceEntry =
  ConfigurationCatalogReference<GatewayConfigurationName>;

export const GATEWAY_CONFIGURATION_REFERENCE: readonly GatewayConfigurationReferenceEntry[] =
  CONFIGURATION_DEFINITIONS;

function reference(
  name: GatewayConfigurationName,
): GatewayConfigurationReferenceEntry {
  const entry = GATEWAY_CONFIGURATION_REFERENCE.find(
    (candidate) => candidate.name === name,
  );
  if (entry === undefined) {
    throw new Error(`Unknown gateway configuration setting: ${name}`);
  }
  return entry;
}

export const PUSH_GATEWAY_CONFIGURATION_CATALOG = Object.freeze({
  reference,
  references: GATEWAY_CONFIGURATION_REFERENCE,
});
