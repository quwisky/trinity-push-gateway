import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../src/config';

const validSa = {
  type: 'service_account',
  project_id: 'p1',
  client_email: 'gw@p1.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n',
};

const apps = { 'dev.trinityproject.trinity.android': { kind: 'fcm' } };

function parse(
  overrides: { APPS?: unknown; FCM_SERVICE_ACCOUNT?: unknown } = {},
) {
  return parseConfig({
    APPS: apps,
    FCM_SERVICE_ACCOUNT: JSON.stringify(validSa),
    ...overrides,
  });
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as ConfigError).message;
  }
  throw new Error('expected parseConfig to throw');
}

describe('parseConfig', () => {
  it('parses APPS and service account', () => {
    expect(parse()).toEqual({
      apps,
      serviceAccount: {
        projectId: 'p1',
        clientEmail: 'gw@p1.iam.gserviceaccount.com',
        privateKey: validSa.private_key,
      },
    });
  });

  it('rejects an unknown kind', () => {
    expect(messageOf(() => parse({ APPS: { a: { kind: 'apns' } } }))).toContain(
      'APPS',
    );
  });

  it('rejects an array APPS', () => {
    expect(() => parse({ APPS: [{ kind: 'fcm' }] })).toThrow(ConfigError);
    expect(messageOf(() => parse({ APPS: [{ kind: 'fcm' }] }))).toContain(
      'APPS',
    );
  });

  it('rejects empty APPS', () => {
    expect(messageOf(() => parse({ APPS: {} }))).toBe('invalid APPS');
  });

  it('rejects a missing secret', () => {
    expect(messageOf(() => parse({ FCM_SERVICE_ACCOUNT: undefined }))).toBe(
      'FCM_SERVICE_ACCOUNT is not set',
    );
  });

  it.each([42, null, {}, ['x']])(
    'rejects a secret that is not a string (%j)',
    (secret) => {
      expect(messageOf(() => parse({ FCM_SERVICE_ACCOUNT: secret }))).toBe(
        'FCM_SERVICE_ACCOUNT must be a JSON string',
      );
    },
  );

  it('rejects a non-JSON secret', () => {
    expect(messageOf(() => parse({ FCM_SERVICE_ACCOUNT: 'nope' }))).toBe(
      'FCM_SERVICE_ACCOUNT is not valid JSON',
    );
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"x"'],
  ])('rejects a secret that is JSON %s, not an object', (_name, secret) => {
    expect(messageOf(() => parse({ FCM_SERVICE_ACCOUNT: secret }))).toMatch(
      /^invalid FCM_SERVICE_ACCOUNT/,
    );
  });

  it.each(['project_id', 'client_email'])('rejects an empty %s', (field) => {
    const message = messageOf(() =>
      parse({
        FCM_SERVICE_ACCOUNT: JSON.stringify({ ...validSa, [field]: '' }),
      }),
    );
    expect(message).toBe(`invalid FCM_SERVICE_ACCOUNT.${field}`);
  });

  it('rejects a service account missing private_key', () => {
    const rest: Record<string, unknown> = { ...validSa };
    delete rest.private_key;
    expect(() => parse({ FCM_SERVICE_ACCOUNT: JSON.stringify(rest) })).toThrow(
      ConfigError,
    );
  });

  it('unescapes literal \\n in private_key', () => {
    const escaped = {
      ...validSa,
      private_key:
        '-----BEGIN PRIVATE KEY-----\\nMIIB\\n-----END PRIVATE KEY-----\\n',
    };
    const { serviceAccount } = parse({
      FCM_SERVICE_ACCOUNT: JSON.stringify(escaped),
    });
    expect(serviceAccount.privateKey).toContain('\n');
    expect(serviceAccount.privateKey).toBe(validSa.private_key);
  });

  it('never echoes the key in errors', () => {
    const message = messageOf(() =>
      parse({
        FCM_SERVICE_ACCOUNT: JSON.stringify({
          ...validSa,
          private_key: 'SECRETVALUE',
        }),
      }),
    );
    expect(message).toContain('FCM_SERVICE_ACCOUNT.private_key');
    expect(message).not.toContain('SECRETVALUE');
  });
});
