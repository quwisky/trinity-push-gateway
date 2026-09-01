import { expect } from 'bun:test';
import path from 'node:path';

export type TestProviderProfile = 'authentik' | 'pocket-id';
export type TestProviderMode =
  'missing-group' | 'no-profile' | 'success' | 'wrong-group';

type ReadyEvent = {
  readonly callbackUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly clientSecretMethod: 'client_secret_basic' | 'client_secret_post';
  readonly issuer: string;
  readonly postLogoutUrl: string;
  readonly profile: TestProviderProfile;
  readonly type: 'ready';
};

type PromptEvent = {
  readonly name: string;
  readonly type: 'prompt';
};

type ClosedEvent = {
  readonly listening: boolean;
  readonly signal: string;
  readonly type: 'closed';
};

type ProviderEvent = ClosedEvent | PromptEvent | ReadyEvent;

type ProviderOptions = {
  readonly clientSecretMethod?: 'client_secret_basic' | 'client_secret_post';
  readonly gatewayOrigin?: string;
  readonly mode?: TestProviderMode;
  readonly profile: TestProviderProfile;
};

export type TestOidcProvider = ReadyEvent & {
  readonly authorize: (authorizationUrl: URL) => Promise<URL>;
  readonly close: () => Promise<void>;
  readonly events: readonly ProviderEvent[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseEvent(line: string): ProviderEvent {
  const value: unknown = JSON.parse(line) as unknown;
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('OIDC test provider emitted an invalid event.');
  }
  if (
    value.type === 'ready' &&
    typeof value.callbackUrl === 'string' &&
    typeof value.clientId === 'string' &&
    typeof value.clientSecret === 'string' &&
    (value.clientSecretMethod === 'client_secret_basic' ||
      value.clientSecretMethod === 'client_secret_post') &&
    typeof value.issuer === 'string' &&
    typeof value.postLogoutUrl === 'string' &&
    (value.profile === 'authentik' || value.profile === 'pocket-id')
  ) {
    return value as ReadyEvent;
  }
  if (value.type === 'prompt' && typeof value.name === 'string') {
    return value as PromptEvent;
  }
  if (
    value.type === 'closed' &&
    typeof value.listening === 'boolean' &&
    typeof value.signal === 'string'
  ) {
    return value as ClosedEvent;
  }
  throw new Error('OIDC test provider emitted an invalid event shape.');
}

async function collectEvents(
  stream: ReadableStream<Uint8Array>,
  events: ProviderEvent[],
  onEvent: (event: ProviderEvent) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffered = '';
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true });
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline === -1) {
        break;
      }
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line.startsWith('HARNESS ')) {
        const event = parseEvent(line.slice('HARNESS '.length));
        events.push(event);
        onEvent(event);
      }
    }
  }
  buffered += decoder.decode();
  const tail = buffered.trim();
  if (tail.startsWith('HARNESS ')) {
    const event = parseEvent(tail.slice('HARNESS '.length));
    events.push(event);
    onEvent(event);
  }
}

type StoredCookie = {
  readonly domain: string;
  readonly hostOnly: boolean;
  readonly name: string;
  readonly path: string;
  readonly secure: boolean;
  readonly value: string;
};

class CookieJar {
  private readonly cookies = new Map<string, StoredCookie>();

  absorb(responseUrl: URL, headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const [pair = '', ...rawAttributes] = line.split(';');
      const separator = pair.indexOf('=');
      if (separator < 1) {
        continue;
      }
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const attributes = new Map(
        rawAttributes.map((raw) => {
          const [key = '', ...rest] = raw.trim().split('=');
          return [key.toLowerCase(), rest.join('=')];
        }),
      );
      const domain = (
        attributes.get('domain') ?? responseUrl.hostname
      ).toLowerCase();
      const cookiePath = attributes.get('path') ?? '/';
      const key = `${name};${domain};${cookiePath}`;
      if (value === '' || Number(attributes.get('max-age')) === 0) {
        this.cookies.delete(key);
        continue;
      }
      this.cookies.set(key, {
        domain,
        hostOnly: !attributes.has('domain'),
        name,
        path: cookiePath,
        secure: attributes.has('secure'),
        value,
      });
    }
  }

  header(url: URL): string {
    return [...this.cookies.values()]
      .filter((cookie) => {
        const domainMatches = cookie.hostOnly
          ? url.hostname === cookie.domain
          : url.hostname === cookie.domain ||
            url.hostname.endsWith(`.${cookie.domain}`);
        const pathMatches =
          url.pathname === cookie.path ||
          url.pathname.startsWith(
            cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`,
          );
        return (
          domainMatches &&
          pathMatches &&
          (!cookie.secure || url.protocol === 'https:')
        );
      })
      .sort((left, right) => right.path.length - left.path.length)
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ');
  }
}

async function driveBrowserFlow(
  authorizationUrl: URL,
  callbackUrl: string,
): Promise<URL> {
  const cookies = new CookieJar();
  let next = authorizationUrl;
  for (let redirectCount = 0; redirectCount < 10; redirectCount += 1) {
    const cookie = cookies.header(next);
    const response = await fetch(next, {
      ...(cookie === '' ? {} : { headers: { cookie } }),
      redirect: 'manual',
    });
    cookies.absorb(next, response.headers);
    const location = response.headers.get('location');
    expect(response.status).toBe(303);
    if (location === null) {
      throw new Error('OIDC test provider omitted a redirect location.');
    }
    const target = new URL(location, next);
    if (target.origin + target.pathname === callbackUrl) {
      return target;
    }
    next = target;
  }
  throw new Error('OIDC test provider exceeded its redirect limit.');
}

export async function startTestOidcProvider(
  options: ProviderOptions,
): Promise<TestOidcProvider> {
  const nodeBinary = Bun.which('node');
  if (nodeBinary === null) {
    throw new Error('The OIDC contract suite requires Node.js.');
  }
  const child: Bun.ReadableSubprocess = Bun.spawn(
    [
      nodeBinary,
      path.join(import.meta.dir, '../../../../scripts/test-oidc-provider.mjs'),
      options.profile,
      options.mode ?? 'success',
      options.clientSecretMethod ?? 'client_secret_basic',
    ],
    {
      ...(options.gatewayOrigin === undefined
        ? {}
        : {
            env: {
              ...process.env,
              TRINITY_TEST_GATEWAY_ORIGIN: options.gatewayOrigin,
            },
          }),
      stderr: 'pipe',
      stdout: 'pipe',
    },
  );
  const events: ProviderEvent[] = [];
  const ready = Promise.withResolvers<ReadyEvent>();
  const stdoutDone = collectEvents(child.stdout, events, (event) => {
    if (event.type === 'ready') {
      ready.resolve(event);
    }
  }).catch(ready.reject);
  const stderrDone = new Response(child.stderr).text();
  const startup = await Promise.race([
    ready.promise,
    child.exited.then((exitCode) => {
      throw new Error(
        `OIDC test provider exited before startup with code ${exitCode}.`,
      );
    }),
  ]);
  let closed = false;
  return {
    ...startup,
    authorize: (authorizationUrl) =>
      driveBrowserFlow(authorizationUrl, startup.callbackUrl),
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      await stdoutDone;
      const stderr = await stderrDone;
      if (exitCode !== 0) {
        throw new Error(`OIDC test provider exited with code ${exitCode}.`);
      }
      if (stderr.includes('Unsupported runtime')) {
        throw new Error('OIDC test provider ran under an unsupported runtime.');
      }
    },
    events,
  };
}
