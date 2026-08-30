import { fingerprintFor } from './fingerprint';
import type { DeliveryClaim, DeliveryIdentity } from './ports';

type DeliveryRow = {
  readonly lease_expires_at: number | null;
  readonly outcome: 'delivered' | 'pending' | 'rejected';
};

export async function claimDelivery(
  database: D1Database,
  identity: DeliveryIdentity,
  fingerprintKey: string,
  nowSeconds: number,
  leaseSeconds: number,
): Promise<DeliveryClaim> {
  const fingerprint = await fingerprintFor(identity, fingerprintKey);
  const leaseExpiresAt = nowSeconds + leaseSeconds;
  const acquired = await database
    .prepare(
      `INSERT INTO delivery_records
        (fingerprint, outcome, lease_expires_at, expires_at, reason_category)
       VALUES (?1, 'pending', ?2, ?2, NULL)
       ON CONFLICT (fingerprint) DO UPDATE SET
         outcome = 'pending',
         lease_expires_at = excluded.lease_expires_at,
         expires_at = excluded.expires_at,
         reason_category = NULL
       WHERE delivery_records.expires_at <= ?3
          OR (delivery_records.outcome = 'pending'
              AND delivery_records.lease_expires_at <= ?3)
       RETURNING fingerprint`,
    )
    .bind(fingerprint, leaseExpiresAt, nowSeconds)
    .first<{ readonly fingerprint: string }>();
  if (acquired !== null) {
    return { fingerprint, kind: 'acquired' };
  }

  const existing = await database
    .prepare(
      `SELECT outcome, lease_expires_at
       FROM delivery_records
       WHERE fingerprint = ?1`,
    )
    .bind(fingerprint)
    .first<DeliveryRow>();
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
        (existing.lease_expires_at ?? nowSeconds + 1) - nowSeconds,
      ),
    };
  }
  throw new Error('Delivery claim disappeared.');
}

export async function completeDelivery(
  database: D1Database,
  fingerprint: string,
  outcome: 'delivered' | 'rejected',
  reasonCategory: string | undefined,
  expiresAt: number,
): Promise<void> {
  await database
    .prepare(
      `UPDATE delivery_records
       SET outcome = ?2,
           lease_expires_at = NULL,
           expires_at = ?3,
           reason_category = ?4
       WHERE fingerprint = ?1`,
    )
    .bind(fingerprint, outcome, expiresAt, reasonCategory ?? null)
    .run();
}

export async function releaseDelivery(
  database: D1Database,
  fingerprint: string,
): Promise<void> {
  await database
    .prepare(
      `DELETE FROM delivery_records
       WHERE fingerprint = ?1 AND outcome = 'pending'`,
    )
    .bind(fingerprint)
    .run();
}
