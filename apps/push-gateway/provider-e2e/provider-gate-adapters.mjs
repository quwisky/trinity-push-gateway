import { authentikAdapter } from './authentik-adapter.mjs';
import { pocketIdAdapter } from './pocket-id-adapter.mjs';

const providerDefinitions = Object.freeze(
  [
    { adapter: pocketIdAdapter, timeoutMinutes: 25 },
    { adapter: authentikAdapter, timeoutMinutes: 40 },
  ].map(Object.freeze),
);

const definitions = new Map(
  providerDefinitions.map((definition) => [definition.adapter.id, definition]),
);

export const realProviderIds = Object.freeze([...definitions.keys()]);

function realProviderDefinition(providerId) {
  const definition = definitions.get(providerId);
  if (definition === undefined) {
    throw new Error(
      `Unknown real provider ${providerId}; expected ${realProviderIds.join(' or ')}.`,
    );
  }
  return definition;
}

export function realProviderAdapter(providerId) {
  return realProviderDefinition(providerId).adapter;
}

export function realProviderMatrixEntry(providerId) {
  const { adapter, timeoutMinutes } = realProviderDefinition(providerId);
  return Object.freeze({
    displayName: adapter.displayName,
    id: adapter.id,
    timeoutMinutes,
  });
}
