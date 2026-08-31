import { describe, expect, it } from 'bun:test';

import { ADMINISTRATION_CONFIGURATION_CATALOG } from '../../../src/configuration-catalog';

type Environment = Readonly<Record<string, string | undefined>>;

function legacyRepresentativeState(
  environment: Environment,
  readFile: (path: string) => string,
): ReturnType<typeof ADMINISTRATION_CONFIGURATION_CATALOG.load> {
  const enabled = environment.TRINITY_PUSH_GATEWAY_ADMIN_ENABLED ?? 'false';
  if (enabled === 'false') {
    return { kind: 'disabled' };
  }
  if (enabled !== 'true') {
    return { kind: 'invalid' };
  }

  try {
    const direct = environment.TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET;
    const file = environment.TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE;
    if (direct !== undefined && file !== undefined) {
      return { kind: 'invalid' };
    }

    const sessionSecret =
      direct !== undefined
        ? direct.length === 0
          ? undefined
          : { source: 'env' as const, value: direct }
        : file === undefined || file.length === 0
          ? undefined
          : { source: 'file' as const, value: readFile(file).trimEnd() };
    if (
      sessionSecret === undefined ||
      new TextEncoder().encode(sessionSecret.value).byteLength < 32
    ) {
      return { kind: 'invalid' };
    }

    return {
      configuration: { administrationEnabled: true, sessionSecret },
      kind: 'enabled',
      safe: {
        administrationEnabled: true,
        sessionSecret: { configured: true, source: sessionSecret.source },
      },
    };
  } catch {
    return { kind: 'invalid' };
  }
}

describe('authoritative administration configuration catalog', () => {
  it('owns the public enable setting and skips secrets while disabled', () => {
    let readCount = 0;

    expect(
      ADMINISTRATION_CONFIGURATION_CATALOG.reference(
        'TRINITY_PUSH_GATEWAY_ADMIN_ENABLED',
      ),
    ).toEqual({
      constraint:
        'Exact true or false; every other administration value is ignored while false.',
      defaultValue: 'false',
      description: 'Opt in to the isolated Bun administration surface.',
      name: 'TRINITY_PUSH_GATEWAY_ADMIN_ENABLED',
      required: false,
      runtimes: ['bun'],
      secret: false,
    });

    expect(
      ADMINISTRATION_CONFIGURATION_CATALOG.load(
        {
          TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE: '/does/not/exist',
        },
        {
          readFile: () => {
            readCount += 1;
            throw new Error('disabled configuration must not read secrets');
          },
        },
      ),
    ).toEqual({ kind: 'disabled' });
    expect(readCount).toBe(0);
  });

  it('loads direct and file-backed Operator Session secrets safely', () => {
    const directValue = 'd'.repeat(32);
    const direct = ADMINISTRATION_CONFIGURATION_CATALOG.load(
      {
        TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: directValue,
      },
      {
        readFile: () => {
          throw new Error('a direct secret must not read a file');
        },
      },
    );

    expect(direct).toEqual({
      configuration: {
        administrationEnabled: true,
        sessionSecret: { source: 'env', value: directValue },
      },
      kind: 'enabled',
      safe: {
        administrationEnabled: true,
        sessionSecret: { configured: true, source: 'env' },
      },
    });

    const fileValue = 'f'.repeat(32);
    const fromFile = ADMINISTRATION_CONFIGURATION_CATALOG.load(
      {
        TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE: '/run/secrets/session',
      },
      {
        readFile: (path) => {
          expect(path).toBe('/run/secrets/session');
          return `${fileValue}\n`;
        },
      },
    );

    expect(fromFile).toEqual({
      configuration: {
        administrationEnabled: true,
        sessionSecret: { source: 'file', value: fileValue },
      },
      kind: 'enabled',
      safe: {
        administrationEnabled: true,
        sessionSecret: { configured: true, source: 'file' },
      },
    });
    expect(JSON.stringify(fromFile)).not.toContain('/run/secrets/session');

    expect(
      ADMINISTRATION_CONFIGURATION_CATALOG.reference(
        'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET',
      ),
    ).toMatchObject({
      name: 'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET',
      required: false,
      runtimes: ['bun'],
      secret: true,
    });
    expect(
      ADMINISTRATION_CONFIGURATION_CATALOG.reference(
        'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE',
      ),
    ).toMatchObject({
      name: 'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE',
      required: false,
      runtimes: ['bun'],
      secret: true,
    });
  });

  it.each([
    {
      environment: { TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'yes' },
      name: 'an invalid enable value',
      readFile: () => 'unused',
    },
    {
      environment: {
        TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: 'd'.repeat(32),
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE: '/run/secrets/session',
      },
      name: 'both secret sources',
      readFile: () => 'unused',
    },
    {
      environment: {
        TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: 'too-short',
      },
      name: 'a short direct secret',
      readFile: () => 'unused',
    },
    {
      environment: {
        TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE: '/does/not/exist',
      },
      name: 'an unreadable secret file',
      readFile: (): never => {
        throw new Error('missing secret file');
      },
    },
  ])('fails closed for $name', ({ environment, readFile }) => {
    expect(
      ADMINISTRATION_CONFIGURATION_CATALOG.load(environment, { readFile }),
    ).toEqual({ kind: 'invalid' });
  });

  it.each([
    {
      environment: {},
      name: 'disabled',
      readFile: () => {
        throw new Error('disabled configuration must not read secrets');
      },
    },
    {
      environment: {
        TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: 'd'.repeat(32),
      },
      name: 'direct secret',
      readFile: () => {
        throw new Error('a direct secret must not read a file');
      },
    },
    {
      environment: {
        TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE: '/run/secrets/session',
      },
      name: 'file secret',
      readFile: () => `${'f'.repeat(32)}\n`,
    },
  ])(
    'matches the legacy $name runtime and safe output',
    ({ environment, readFile }) => {
      expect(
        ADMINISTRATION_CONFIGURATION_CATALOG.load(environment, { readFile }),
      ).toEqual(legacyRepresentativeState(environment, readFile));
    },
  );
});
