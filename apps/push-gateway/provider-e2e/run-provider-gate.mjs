import {
  cleanupProviderGate,
  runProviderGate,
} from './provider-gate-lifecycle.mjs';
import {
  realProviderAdapter,
  realProviderIds,
} from './provider-gate-adapters.mjs';

const [providerArgument, operationArgument] = process.argv.slice(2);
const provider = process.env.PROVIDER_GATE_PROVIDER ?? providerArgument;
const operation =
  process.env.PROVIDER_GATE_OPERATION ?? operationArgument ?? 'run';
if (provider === undefined || !['cleanup', 'run'].includes(operation)) {
  throw new Error(
    `Usage: PROVIDER_GATE_PROVIDER=<${realProviderIds.join('|')}> PROVIDER_GATE_OPERATION=<run|cleanup> run-provider-gate.mjs`,
  );
}
const adapter = realProviderAdapter(provider);

if (operation === 'cleanup') {
  await cleanupProviderGate(adapter);
} else {
  await runProviderGate(adapter);
}
