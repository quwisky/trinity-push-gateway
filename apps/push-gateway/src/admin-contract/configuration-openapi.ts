import { CONFIGURATION_RESPONSE_SCHEMA } from './configuration';
import { adminContractOpenApiComponents, type JsonValue } from './openapi';

const COMPONENT_ORDER = [
  'PositiveSafeInteger',
  'ConfigurationSource',
  'SecretPresence',
  'GatewayConfiguration',
  'AdministrationConfiguration',
  'CredentialPresence',
  'Configuration',
] as const;

export function configurationOpenApiComponents(): Readonly<
  Record<(typeof COMPONENT_ORDER)[number], JsonValue>
> {
  return adminContractOpenApiComponents(
    CONFIGURATION_RESPONSE_SCHEMA,
    COMPONENT_ORDER,
    ['UtcTimestamp'],
  );
}
