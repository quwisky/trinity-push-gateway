import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const NONCE_PLACEHOLDER = '__TRINITY_ADMIN_CSP_NONCE__';
const HASHED_ASSET_NAME =
  /^(?:chunk|main|styles)-[A-Za-z0-9_-]{8,}\.(?:css|js)$/u;
const INLINE_EVENT_HANDLER = /\son[a-z]+\s*=/iu;
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>/iu;
const INLINE_STYLE = /<style\b/iu;
const ROOT_NONCE_MARKER = new RegExp(
  `<tpg-root\\b[^>]*\\bngcspnonce="${NONCE_PLACEHOLDER}"`,
  'iu',
);
const SCRIPT_TAG = /<script\b[^>]*>/giu;

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
} as const);

export const ADMIN_SPA_ROUTES = Object.freeze([
  '/admin/',
  '/admin/sign-in',
  '/admin/overview',
  '/admin/metrics',
  '/admin/operations',
  '/admin/configuration',
  '/admin/security',
] as const);

type AdminAsset = Readonly<{
  bytes: ArrayBuffer;
  contentType: string;
  etag: string;
}>;

type LoadAdminAssetsOptions = Readonly<{
  nonce?: () => string;
}>;

export type AdminAssetCatalog = Readonly<{
  /**
   * Returns an exact static-asset or known-SPA response. Unknown paths and
   * unsupported methods return undefined so the owning router can produce its
   * generic 404 without an Angular fallback.
   */
  responseFor(request: Request): Response | undefined;
}>;

function configurationError(): Error {
  return new Error('Administration asset output is invalid.');
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function validateIndexTemplate(
  template: string,
  assets: ReadonlyMap<string, AdminAsset>,
): void {
  const scripts = [...template.matchAll(SCRIPT_TAG)].map((match) => match[0]);
  if (
    scripts.length === 0 ||
    countOccurrences(template, NONCE_PLACEHOLDER) !== scripts.length + 1 ||
    !ROOT_NONCE_MARKER.test(template) ||
    scripts.some(
      (script) =>
        !/\bsrc="[^"]+"/u.test(script) ||
        !script.includes(`nonce="${NONCE_PLACEHOLDER}"`),
    ) ||
    INLINE_EVENT_HANDLER.test(template) ||
    INLINE_SCRIPT.test(template) ||
    INLINE_STYLE.test(template)
  ) {
    throw configurationError();
  }

  const references = [...template.matchAll(/\b(?:href|src)="([^"]+)"/gu)].map(
    (match) => match[1],
  );
  if (references.length === 0) {
    throw configurationError();
  }
  for (const reference of references) {
    if (reference === '/admin/') {
      continue;
    }
    if (
      reference === undefined ||
      reference.startsWith('/') ||
      reference.includes('..') ||
      !assets.has(`/admin/${reference}`)
    ) {
      throw configurationError();
    }
  }
}

function freshNonce(): string {
  return randomBytes(16).toString('base64url');
}

function validNonce(nonce: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/u.test(nonce);
}

function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}'`,
    // Angular and Chart.js update element styles. This exception is limited to
    // style attributes; executable script remains nonce- and Trusted-Types-only.
    "style-src-attr 'unsafe-inline'",
    "worker-src 'none'",
    "require-trusted-types-for 'script'",
    'trusted-types angular angular#bundler',
  ].join('; ');
}

function htmlHeaders(nonce: string): Headers {
  return new Headers({
    'cache-control': 'no-store',
    'content-security-policy': contentSecurityPolicy(nonce),
    'content-type': 'text/html; charset=utf-8',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'origin-agent-cluster': '?1',
    'permissions-policy':
      'accelerometer=(), autoplay=(), camera=(), display-capture=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), picture-in-picture=(), screen-wake-lock=(), serial=(), usb=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-dns-prefetch-control': 'off',
    'x-download-options': 'noopen',
    'x-frame-options': 'DENY',
    'x-permitted-cross-domain-policies': 'none',
    'x-xss-protection': '0',
  });
}

function assetHeaders(asset: AdminAsset): Headers {
  return new Headers({
    'cache-control': 'public, max-age=31536000, immutable',
    'content-length': String(asset.bytes.byteLength),
    'content-type': asset.contentType,
    'cross-origin-resource-policy': 'same-origin',
    etag: asset.etag,
    'x-content-type-options': 'nosniff',
  });
}

function etagMatches(request: Request, etag: string): boolean {
  const condition = request.headers.get('if-none-match');
  return (
    condition === '*' ||
    condition
      ?.split(',')
      .map((candidate) => candidate.trim())
      .includes(etag) === true
  );
}

function loadAsset(directory: string, name: string): AdminAsset {
  const extension = path.extname(name);
  const contentType = CONTENT_TYPES[extension];
  if (contentType === undefined || !HASHED_ASSET_NAME.test(name)) {
    throw configurationError();
  }
  const filePath = path.join(directory, name);
  const metadata = lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw configurationError();
  }
  const bytes = Uint8Array.from(readFileSync(filePath)).buffer;
  const digest = createHash('sha256')
    .update(new Uint8Array(bytes))
    .digest('base64url');
  return Object.freeze({
    bytes,
    contentType,
    etag: `"sha256-${digest}"`,
  });
}

export function loadAdminAssets(
  directory: string,
  options: LoadAdminAssetsOptions = {},
): AdminAssetCatalog {
  const entries = readdirSync(directory, { withFileTypes: true });
  const assets = new Map<string, AdminAsset>();
  let indexTemplate: string | undefined;

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    const metadata = lstatSync(filePath);
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      metadata.isSymbolicLink() ||
      !metadata.isFile()
    ) {
      throw configurationError();
    }
    if (entry.name === 'index.html') {
      indexTemplate = readFileSync(filePath, 'utf8');
      continue;
    }
    if (
      entry.name.endsWith('.map') ||
      entry.name.endsWith('.html') ||
      entry.name.endsWith('.json')
    ) {
      throw configurationError();
    }
    assets.set(`/admin/${entry.name}`, loadAsset(directory, entry.name));
  }

  if (indexTemplate === undefined || assets.size === 0) {
    throw configurationError();
  }
  validateIndexTemplate(indexTemplate, assets);

  const knownSpaRoutes = new Set<string>(ADMIN_SPA_ROUTES);
  const nonceFactory = options.nonce ?? freshNonce;
  return Object.freeze({
    responseFor(request: Request): Response | undefined {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return undefined;
      }
      const pathname = new URL(request.url).pathname;
      const asset = assets.get(pathname);
      if (asset !== undefined) {
        const headers = assetHeaders(asset);
        if (etagMatches(request, asset.etag)) {
          headers.delete('content-length');
          return new Response(null, { headers, status: 304 });
        }
        return new Response(request.method === 'HEAD' ? null : asset.bytes, {
          headers,
          status: 200,
        });
      }
      if (!knownSpaRoutes.has(pathname)) {
        return undefined;
      }

      const nonce = nonceFactory();
      if (!validNonce(nonce)) {
        throw configurationError();
      }
      const html = indexTemplate.replaceAll(NONCE_PLACEHOLDER, nonce);
      return new Response(request.method === 'HEAD' ? null : html, {
        headers: htmlHeaders(nonce),
        status: 200,
      });
    },
  });
}
