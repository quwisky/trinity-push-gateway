import {
  cleanupProviderGate,
  runProviderGate,
} from './provider-gate-lifecycle.mjs';
import { authentikAdapter } from './authentik-adapter.mjs';
import { pocketIdAdapter } from './pocket-id-adapter.mjs';

const [provider, operation = 'run'] = process.argv.slice(2);
const adapters = new Map(
  [authentikAdapter, pocketIdAdapter].map((adapter) => [adapter.id, adapter]),
);
const adapter = adapters.get(provider);
if (adapter === undefined || !['cleanup', 'run'].includes(operation)) {
  throw new Error(
    'Usage: run-provider-gate.mjs <authentik|pocket-id> [run|cleanup]',
  );
}

if (operation === 'cleanup') {
  await cleanupProviderGate(adapter);
} else {
  await runProviderGate(adapter);
}
