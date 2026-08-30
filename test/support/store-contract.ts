import type { GatewayStore } from '../../src/ports';

export async function exerciseStoreContract(store: GatewayStore): Promise<{
  readonly budget: readonly boolean[];
  readonly claims: readonly string[];
}> {
  const identity = {
    accountRoute: 'contract-account',
    appId: 'contract.android',
    eventId: '$contract:example.test',
    pushKey: 'contract-push-key',
  };
  const first = await store.claimDelivery(identity, 'c'.repeat(32), 100, 10);
  if (first.kind !== 'acquired') {
    throw new Error('Contract expected the first claim to be acquired.');
  }
  const pending = await store.claimDelivery(identity, 'c'.repeat(32), 101, 10);
  await store.releaseDelivery(first.fingerprint);
  const reacquired = await store.claimDelivery(
    identity,
    'c'.repeat(32),
    102,
    10,
  );
  if (reacquired.kind !== 'acquired') {
    throw new Error('Contract expected a released claim to be reacquired.');
  }
  await store.completeDelivery(
    reacquired.fingerprint,
    'rejected',
    'unregistered',
    200,
  );
  const terminal = await store.claimDelivery(identity, 'c'.repeat(32), 150, 10);
  await store.cleanup(201, '2033-05-19');
  const expired = await store.claimDelivery(identity, 'c'.repeat(32), 202, 10);
  return {
    budget: [
      await store.reserveDailyAttempts('2033-05-18', 2, 3),
      await store.reserveDailyAttempts('2033-05-18', 2, 3),
      await store.reserveDailyAttempts('2033-05-18', 1, 3),
    ],
    claims: [
      first.kind,
      pending.kind,
      reacquired.kind,
      terminal.kind,
      expired.kind,
    ],
  };
}
