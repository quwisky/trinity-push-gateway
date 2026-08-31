import { ADMINISTRATION_CONFIGURATION_DEFINITIONS } from './configuration-catalog/administration';
import { BUN_CONFIGURATION_DEFINITIONS } from './configuration-catalog/bun';
import { COMPOSE_CONFIGURATION_DEFINITIONS } from './configuration-catalog/compose';
import { SHARED_CONFIGURATION_DEFINITIONS } from './configuration-catalog/shared';
import type {
  ConfigurationCatalogReference,
  ConfigurationRuntime,
} from './configuration-catalog/types';

const CONFIGURATION_REFERENCES = Object.freeze([
  ...SHARED_CONFIGURATION_DEFINITIONS,
  ...BUN_CONFIGURATION_DEFINITIONS,
  ...ADMINISTRATION_CONFIGURATION_DEFINITIONS,
  ...COMPOSE_CONFIGURATION_DEFINITIONS,
]);

export type GatewayConfigurationName =
  (typeof CONFIGURATION_REFERENCES)[number]['name'];
export type GatewayConfigurationReferenceEntry =
  ConfigurationCatalogReference<GatewayConfigurationName>;

const REFERENCE_BY_NAME = new Map<string, GatewayConfigurationReferenceEntry>(
  CONFIGURATION_REFERENCES.map((entry) => [entry.name, entry] as const),
);

function referencesForRuntime(
  runtime: ConfigurationRuntime,
): readonly GatewayConfigurationReferenceEntry[] {
  return Object.freeze(
    CONFIGURATION_REFERENCES.filter((entry) =>
      entry.runtimes.some((candidate) => candidate === runtime),
    ),
  );
}

const REFERENCES_BY_RUNTIME: Readonly<
  Record<ConfigurationRuntime, readonly GatewayConfigurationReferenceEntry[]>
> = Object.freeze({
  bun: referencesForRuntime('bun'),
  cloudflare: referencesForRuntime('cloudflare'),
  compose: referencesForRuntime('compose'),
});

function reference(
  name: string,
): GatewayConfigurationReferenceEntry | undefined {
  return REFERENCE_BY_NAME.get(name);
}

function references(
  runtime?: ConfigurationRuntime,
): readonly GatewayConfigurationReferenceEntry[] {
  return runtime === undefined
    ? CONFIGURATION_REFERENCES
    : REFERENCES_BY_RUNTIME[runtime];
}

export const PUSH_GATEWAY_CONFIGURATION_CATALOG = Object.freeze({
  reference,
  references,
});
