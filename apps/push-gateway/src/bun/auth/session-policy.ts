import { timingSafeEqual } from 'node:crypto';

export const OPERATOR_SESSION_POLICY = {
  absoluteSeconds: 8 * 60 * 60,
  idleSeconds: 30 * 60,
  maximumGlobalSessions: 100,
  maximumSessionsPerIdentity: 5,
} as const;

export const OPERATOR_SESSION_COOKIE = {
  httpOnly: true,
  name: 'TRINITY_ADMIN_SESSION',
  path: '/',
  sameSite: 'strict',
  secure: true,
} as const;

export type OperatorIdentityKey = {
  readonly issuer: string;
  readonly subject: string;
};

export type OperatorSession = {
  readonly absoluteExpiresAt: number;
  readonly createdAt: number;
  readonly id: string;
  readonly identity: OperatorIdentityKey;
  readonly idleExpiresAt: number;
  readonly policyFingerprint: string;
  readonly revokedAt: number | undefined;
  readonly xsrfToken: string;
};

export type OperatorSessionOutcome =
  'absolute_expired' | 'active' | 'idle_expired' | 'policy_changed' | 'revoked';

export function evaluateOperatorSession(
  session: OperatorSession,
  nowSeconds: number,
  currentPolicyFingerprint: string,
): OperatorSessionOutcome {
  if (session.revokedAt !== undefined) {
    return 'revoked';
  }
  if (session.policyFingerprint !== currentPolicyFingerprint) {
    return 'policy_changed';
  }
  if (nowSeconds >= session.absoluteExpiresAt) {
    return 'absolute_expired';
  }
  if (nowSeconds >= session.idleExpiresAt) {
    return 'idle_expired';
  }
  return 'active';
}

export function renewedOperatorSessionIdleExpiry(
  session: OperatorSession,
  nowSeconds: number,
): number {
  return Math.min(
    session.absoluteExpiresAt,
    nowSeconds + OPERATOR_SESSION_POLICY.idleSeconds,
  );
}

function sameIdentity(
  left: OperatorIdentityKey,
  right: OperatorIdentityKey,
): boolean {
  return left.issuer === right.issuer && left.subject === right.subject;
}

function oldestFirst(left: OperatorSession, right: OperatorSession): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

export function selectOperatorSessionEvictions(
  activeSessions: readonly OperatorSession[],
  identity: OperatorIdentityKey,
): readonly string[] {
  const evictions = new Set<string>();
  const identitySessions = activeSessions
    .filter((session) => sameIdentity(session.identity, identity))
    .sort(oldestFirst);
  const identityExcess = Math.max(
    0,
    identitySessions.length -
      OPERATOR_SESSION_POLICY.maximumSessionsPerIdentity +
      1,
  );
  for (const session of identitySessions.slice(0, identityExcess)) {
    evictions.add(session.id);
  }

  const remaining = activeSessions
    .filter((session) => !evictions.has(session.id))
    .sort(oldestFirst);
  const globalExcess = Math.max(
    0,
    remaining.length - OPERATOR_SESSION_POLICY.maximumGlobalSessions + 1,
  );
  for (const session of remaining.slice(0, globalExcess)) {
    evictions.add(session.id);
  }
  return [...evictions];
}

type OperatorMutationProof = {
  readonly cookieToken: string | undefined;
  readonly expectedOrigin: string;
  readonly headerToken: string | undefined;
  readonly requestOrigin: string | undefined;
  readonly sessionToken: string;
};

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function authorizeOperatorMutation(
  proof: OperatorMutationProof,
): boolean {
  return (
    proof.requestOrigin === proof.expectedOrigin &&
    proof.sessionToken.length > 0 &&
    proof.cookieToken !== undefined &&
    proof.headerToken !== undefined &&
    equalSecret(proof.cookieToken, proof.sessionToken) &&
    equalSecret(proof.headerToken, proof.sessionToken)
  );
}
