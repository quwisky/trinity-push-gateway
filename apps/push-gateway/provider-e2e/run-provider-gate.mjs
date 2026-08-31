import {
  cleanupProviderGate,
  runProviderGate,
} from './provider-gate-lifecycle.mjs';
import { pocketIdAdapter } from './pocket-id-adapter.mjs';

const [provider, operation = 'run'] = process.argv.slice(2);
if (
  provider !== pocketIdAdapter.id ||
  !['cleanup', 'run'].includes(operation)
) {
  throw new Error('Usage: run-provider-gate.mjs pocket-id [run|cleanup]');
}

if (operation === 'cleanup') {
  await cleanupProviderGate(pocketIdAdapter);
} else {
  await runProviderGate(pocketIdAdapter);
}
