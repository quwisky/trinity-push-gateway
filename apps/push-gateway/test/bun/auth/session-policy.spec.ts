import { describe, expect, it } from 'bun:test';

import {
  OPERATOR_SESSION_COOKIE,
  OPERATOR_SESSION_POLICY,
  authorizeOperatorMutation,
  evaluateOperatorSession,
  renewedOperatorSessionIdleExpiry,
  selectOperatorSessionEvictions,
  type OperatorSession,
} from '../../../src/bun/auth/session-policy';

const identity = { issuer: 'https://issuer.example/', subject: 'operator-1' };

function session(overrides: Partial<OperatorSession> = {}): OperatorSession {
  return {
    absoluteExpiresAt: 28_800,
    createdAt: 0,
    id: 'session-1',
    identity,
    idleExpiresAt: 1_800,
    policyFingerprint: 'policy-a',
    revokedAt: undefined,
    xsrfToken: 'xsrf-session-1',
    ...overrides,
  };
}

describe('Operator Session policy', () => {
  it('expires at the 30-minute idle or eight-hour absolute boundary', () => {
    expect(evaluateOperatorSession(session(), 1_799, 'policy-a')).toBe(
      'active',
    );
    expect(evaluateOperatorSession(session(), 1_800, 'policy-a')).toBe(
      'idle_expired',
    );
    expect(
      evaluateOperatorSession(
        session({ idleExpiresAt: 40_000 }),
        28_800,
        'policy-a',
      ),
    ).toBe('absolute_expired');
    expect(renewedOperatorSessionIdleExpiry(session(), 1_000)).toBe(2_800);
    expect(
      renewedOperatorSessionIdleExpiry(
        session({ absoluteExpiresAt: 2_000 }),
        1_000,
      ),
    ).toBe(2_000);
  });

  it('invalidates a revoked session or changed policy immediately', () => {
    expect(
      evaluateOperatorSession(session({ revokedAt: 10 }), 10, 'policy-a'),
    ).toBe('revoked');
    expect(evaluateOperatorSession(session(), 10, 'policy-b')).toBe(
      'policy_changed',
    );
  });

  it('selects deterministic oldest evictions for both session caps', () => {
    const sessions = Array.from({ length: 100 }, (_, index) =>
      session({
        createdAt: index,
        id: `session-${index.toString().padStart(3, '0')}`,
        identity:
          index < 5
            ? identity
            : {
                issuer: 'https://issuer.example/',
                subject: `operator-${index}`,
              },
      }),
    );

    expect(selectOperatorSessionEvictions(sessions, identity)).toEqual([
      'session-000',
    ]);
    expect(OPERATOR_SESSION_POLICY).toEqual({
      absoluteSeconds: 28_800,
      idleSeconds: 1_800,
      maximumGlobalSessions: 100,
      maximumSessionsPerIdentity: 5,
    });
  });

  it('requires exact origin and the session-bound XSRF value', () => {
    const input = {
      cookieToken: 'xsrf-session-1',
      expectedOrigin: 'https://gateway.example',
      headerToken: 'xsrf-session-1',
      requestOrigin: 'https://gateway.example',
      sessionToken: 'xsrf-session-1',
    };

    expect(authorizeOperatorMutation(input)).toBe(true);
    expect(
      authorizeOperatorMutation({
        ...input,
        requestOrigin: 'https://gateway.example:443',
      }),
    ).toBe(false);
    expect(
      authorizeOperatorMutation({ ...input, headerToken: 'other-session' }),
    ).toBe(false);
    expect(
      authorizeOperatorMutation({
        ...input,
        cookieToken: '',
        headerToken: '',
        sessionToken: '',
      }),
    ).toBe(false);
    expect(OPERATOR_SESSION_COOKIE).toEqual({
      httpOnly: true,
      name: 'TRINITY_ADMIN_SESSION',
      path: '/',
      sameSite: 'strict',
      secure: true,
    });
    expect('domain' in OPERATOR_SESSION_COOKIE).toBe(false);
  });
});
