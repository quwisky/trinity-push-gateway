import type { GatewayStore } from '../../src/ports';

export async function exerciseStoreContract(store: GatewayStore): Promise<{
  readonly budget: readonly boolean[];
  readonly claims: readonly string[];
  readonly cleanupReleasesExpiredBudget: boolean;
  readonly concurrentBudgetReservations: number;
  readonly concurrentClaims: readonly string[];
  readonly deliveredClaimSurvivesRelease: string;
  readonly pendingLeaseRecovery: readonly string[];
  readonly zeroAndOversizedBudget: readonly boolean[];
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
  await store.reserveDailyAttempts('2033-05-17', 1, 1);
  await store.cleanup(201, '2033-05-19');
  const expired = await store.claimDelivery(identity, 'c'.repeat(32), 202, 10);

  const deliveredIdentity = {
    ...identity,
    eventId: '$delivered:example.test',
  };
  const delivered = await store.claimDelivery(
    deliveredIdentity,
    'c'.repeat(32),
    210,
    10,
  );
  if (delivered.kind !== 'acquired') {
    throw new Error('Contract expected a delivery claim to be acquired.');
  }
  await store.completeDelivery(
    delivered.fingerprint,
    'delivered',
    undefined,
    400,
  );
  await store.releaseDelivery(delivered.fingerprint);
  const deliveredAfterRelease = await store.claimDelivery(
    deliveredIdentity,
    'c'.repeat(32),
    220,
    10,
  );

  const leasedIdentity = {
    ...identity,
    eventId: '$leased:example.test',
  };
  const leased = await store.claimDelivery(
    leasedIdentity,
    'c'.repeat(32),
    300,
    10,
  );
  const pendingLease = await store.claimDelivery(
    leasedIdentity,
    'c'.repeat(32),
    301,
    10,
  );
  const recoveredLease = await store.claimDelivery(
    leasedIdentity,
    'c'.repeat(32),
    310,
    10,
  );
  const concurrentBudget = await Promise.all(
    Array.from({ length: 4 }, () =>
      store.reserveDailyAttempts('2033-05-20', 1, 1),
    ),
  );
  const concurrentIdentity = {
    ...identity,
    eventId: '$concurrent:example.test',
  };
  const concurrentClaims = await Promise.all(
    Array.from({ length: 4 }, () =>
      store.claimDelivery(concurrentIdentity, 'c'.repeat(32), 300, 10),
    ),
  );
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
    cleanupReleasesExpiredBudget: await store.reserveDailyAttempts(
      '2033-05-17',
      1,
      1,
    ),
    concurrentBudgetReservations: concurrentBudget.filter(Boolean).length,
    concurrentClaims: concurrentClaims.map(({ kind }) => kind).sort(),
    deliveredClaimSurvivesRelease: deliveredAfterRelease.kind,
    pendingLeaseRecovery: [leased.kind, pendingLease.kind, recoveredLease.kind],
    zeroAndOversizedBudget: [
      await store.reserveDailyAttempts('2033-05-22', 0, 3),
      await store.reserveDailyAttempts('2033-05-22', 4, 3),
    ],
  };
}

export async function exerciseUnavailableStoreContract(
  store: GatewayStore,
  whileUnavailable: (operation: () => Promise<boolean>) => Promise<boolean>,
): Promise<void> {
  const failedClosed = await whileUnavailable(async () => {
    try {
      await store.reserveDailyAttempts('2033-05-21', 1, 1);
      return false;
    } catch {
      return true;
    }
  });
  if (!failedClosed) {
    throw new Error('Unavailable storage did not fail closed.');
  }
}
