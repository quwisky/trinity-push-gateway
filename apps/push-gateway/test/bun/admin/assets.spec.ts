import { afterEach, describe, expect, it } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ADMIN_SPA_ROUTES,
  loadAdminAssets,
} from '../../../src/bun/admin/assets';

const directories: string[] = [];
const NONCE_PLACEHOLDER = '__TRINITY_ADMIN_CSP_NONCE__';
const FIRST_NONCE = 'AAAAAAAAAAAAAAAAAAAAAA';
const SECOND_NONCE = 'BBBBBBBBBBBBBBBBBBBBBB';

function validIndex(overrides = ''): string {
  return `<!doctype html>
<html lang="en"><head><base href="/admin/">
<link rel="stylesheet" href="styles-ABCDEFGH.css"></head>
<body><tpg-root ngCspNonce="${NONCE_PLACEHOLDER}"></tpg-root>
<script src="main-ABCDEFGH.js" type="module" nonce="${NONCE_PLACEHOLDER}"></script>${overrides}</body></html>`;
}

function outputDirectory(index = validIndex()): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'trinity-admin-assets-'));
  directories.push(directory);
  writeFileSync(path.join(directory, 'index.html'), index);
  writeFileSync(path.join(directory, 'main-ABCDEFGH.js'), 'export {};');
  writeFileSync(path.join(directory, 'styles-ABCDEFGH.css'), ':root{}');
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('administration asset catalog', () => {
  it('serves only known SPA routes with a fresh matching CSP nonce', async () => {
    const nonces = [FIRST_NONCE, SECOND_NONCE];
    const catalog = loadAdminAssets(outputDirectory(), {
      nonce: () => nonces.shift() ?? FIRST_NONCE,
    });

    const first = catalog.responseFor(
      new Request('https://gateway.example/admin/overview'),
    );
    const second = catalog.responseFor(
      new Request('https://gateway.example/admin/security'),
    );
    expect(first?.status).toBe(200);
    expect(second?.status).toBe(200);
    const firstHtml = await first?.text();
    const secondHtml = await second?.text();
    expect(firstHtml).toContain(`ngCspNonce="${FIRST_NONCE}"`);
    expect(firstHtml).toMatch(
      new RegExp(`<script[^>]* nonce="${FIRST_NONCE}"`, 'u'),
    );
    expect(secondHtml).toContain(`ngCspNonce="${SECOND_NONCE}"`);
    expect(secondHtml).toMatch(
      new RegExp(`<script[^>]* nonce="${SECOND_NONCE}"`, 'u'),
    );
    expect(firstHtml).not.toContain(NONCE_PLACEHOLDER);
    expect(first?.headers.get('content-security-policy')).toContain(
      `script-src 'self' 'nonce-${FIRST_NONCE}'`,
    );
    expect(first?.headers.get('content-security-policy')).toContain(
      `style-src 'self' 'nonce-${FIRST_NONCE}'`,
    );
    expect(first?.headers.get('content-security-policy')).toContain(
      "require-trusted-types-for 'script'",
    );
    expect(first?.headers.get('content-security-policy')).toContain(
      'trusted-types angular angular#bundler',
    );
    expect(first?.headers.get('cache-control')).toBe('no-store');
    expect(first?.headers.get('strict-transport-security')).toBeNull();
    expect(first?.headers.get('content-encoding')).toBeNull();

    expect(ADMIN_SPA_ROUTES).toEqual([
      '/admin/',
      '/admin/sign-in',
      '/admin/overview',
      '/admin/metrics',
      '/admin/operations',
      '/admin/configuration',
      '/admin/security',
    ]);
    for (const pathname of [
      '/admin',
      '/admin/unknown',
      '/admin/missing.js',
      '/admin/api/v1/session',
      '/admin/auth/login',
    ]) {
      expect(
        catalog.responseFor(new Request(`https://gateway.example${pathname}`)),
      ).toBeUndefined();
    }
  });

  it('serves exact hashed assets with MIME, ETag, immutable caching, HEAD, and 304', async () => {
    const catalog = loadAdminAssets(outputDirectory());
    const url = 'https://gateway.example/admin/main-ABCDEFGH.js';
    const response = catalog.responseFor(new Request(url));

    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe(
      'text/javascript; charset=utf-8',
    );
    expect(response?.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(response?.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response?.headers.get('etag')).toMatch(/^"sha256-[A-Za-z0-9_-]+"$/u);
    expect(await response?.text()).toBe('export {};');

    const head = catalog.responseFor(new Request(url, { method: 'HEAD' }));
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe('');
    expect(head?.headers.get('content-length')).toBe('10');

    const conditional = catalog.responseFor(
      new Request(url, {
        headers: { 'if-none-match': response?.headers.get('etag') ?? '' },
      }),
    );
    expect(conditional?.status).toBe(304);
    expect(await conditional?.text()).toBe('');
    expect(conditional?.headers.get('content-length')).toBeNull();
  });

  it('does not handle mutation methods even for known paths', () => {
    const catalog = loadAdminAssets(outputDirectory());
    expect(
      catalog.responseFor(
        new Request('https://gateway.example/admin/overview', {
          method: 'POST',
        }),
      ),
    ).toBeUndefined();
    expect(
      catalog.responseFor(
        new Request('https://gateway.example/admin/main-ABCDEFGH.js', {
          method: 'DELETE',
        }),
      ),
    ).toBeUndefined();
  });

  it.each([
    ['source map', 'main-ABCDEFGH.js.map', '{}'],
    ['additional HTML', 'error.html', '<p>error</p>'],
    ['JSON', 'manifest.json', '{}'],
    ['unhashed script', 'runtime.js', 'export {};'],
    ['unexpected file', 'secret.txt', 'secret'],
  ])('rejects %s output', (_label, name, contents) => {
    const directory = outputDirectory();
    writeFileSync(path.join(directory, name), contents);
    expect(() => loadAdminAssets(directory)).toThrow(
      'Administration asset output is invalid.',
    );
  });

  it('rejects symlinks and directories', () => {
    const symlinkDirectory = outputDirectory();
    symlinkSync(
      path.join(symlinkDirectory, 'main-ABCDEFGH.js'),
      path.join(symlinkDirectory, 'chunk-IJKLMNOP.js'),
    );
    expect(() => loadAdminAssets(symlinkDirectory)).toThrow(
      'Administration asset output is invalid.',
    );

    const nestedDirectory = outputDirectory();
    mkdirSync(path.join(nestedDirectory, 'assets'));
    expect(() => loadAdminAssets(nestedDirectory)).toThrow(
      'Administration asset output is invalid.',
    );
  });

  it.each([
    [
      'missing nonce marker',
      validIndex().replace(` ngCspNonce="${NONCE_PLACEHOLDER}"`, ''),
    ],
    ['inline script', validIndex('<script>window.bad=true</script>')],
    ['inline style', validIndex('<style>body{display:none}</style>')],
    [
      'inline event handler',
      validIndex('<link href="styles-ABCDEFGH.css" onload="alert(1)">'),
    ],
    [
      'remote asset',
      validIndex('<script src="https://example.test/bad.js"></script>'),
    ],
  ])('rejects an index containing %s', (_label, index) => {
    expect(() => loadAdminAssets(outputDirectory(index))).toThrow(
      'Administration asset output is invalid.',
    );
  });
});
