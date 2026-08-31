import { and, eq, lte, or, sql } from 'drizzle-orm';

import type { GatewayD1Database } from './d1-database';
import { fingerprintFor } from './fingerprint';
import type { DeliveryClaim, DeliveryIdentity } from './ports';
import { deliveryRecords } from './schema';

export async function claimDelivery(
  database: GatewayD1Database,
  identity: DeliveryIdentity,
  fingerprintKey: string,
  nowSeconds: number,
  leaseSeconds: number,
): Promise<DeliveryClaim> {
  const fingerprint = await fingerprintFor(identity, fingerprintKey);
  const leaseExpiresAt = nowSeconds + leaseSeconds;
  const [acquired] = await database
    .insert(deliveryRecords)
    .values({
      expiresAt: leaseExpiresAt,
      fingerprint,
      leaseExpiresAt,
      outcome: 'pending',
      reasonCategory: null,
    })
    .onConflictDoUpdate({
      set: {
        expiresAt: leaseExpiresAt,
        leaseExpiresAt,
        outcome: 'pending',
        reasonCategory: null,
      },
      setWhere: sql`${or(
        lte(deliveryRecords.expiresAt, nowSeconds),
        and(
          eq(deliveryRecords.outcome, 'pending'),
          lte(deliveryRecords.leaseExpiresAt, nowSeconds),
        ),
      )}`,
      target: deliveryRecords.fingerprint,
    })
    .returning({ fingerprint: deliveryRecords.fingerprint })
    .all();
  if (acquired !== undefined) {
    return { fingerprint, kind: 'acquired' };
  }

  const existing = await database
    .select({
      leaseExpiresAt: deliveryRecords.leaseExpiresAt,
      outcome: deliveryRecords.outcome,
    })
    .from(deliveryRecords)
    .where(eq(deliveryRecords.fingerprint, fingerprint))
    .get();
  if (existing?.outcome === 'delivered') {
    return { kind: 'delivered' };
  }
  if (existing?.outcome === 'rejected') {
    return { kind: 'rejected' };
  }
  if (existing?.outcome === 'pending') {
    return {
      kind: 'pending',
      retryAfterSeconds: Math.max(
        1,
        (existing.leaseExpiresAt ?? nowSeconds + 1) - nowSeconds,
      ),
    };
  }
  throw new Error('Delivery claim disappeared.');
}

export async function completeDelivery(
  database: GatewayD1Database,
  fingerprint: string,
  outcome: 'delivered' | 'rejected',
  reasonCategory: string | undefined,
  expiresAt: number,
): Promise<void> {
  await database
    .update(deliveryRecords)
    .set({
      expiresAt,
      leaseExpiresAt: null,
      outcome,
      reasonCategory: reasonCategory ?? null,
    })
    .where(eq(deliveryRecords.fingerprint, fingerprint))
    .run();
}

export async function releaseDelivery(
  database: GatewayD1Database,
  fingerprint: string,
): Promise<void> {
  await database
    .delete(deliveryRecords)
    .where(
      and(
        eq(deliveryRecords.fingerprint, fingerprint),
        eq(deliveryRecords.outcome, 'pending'),
      ),
    )
    .run();
}
