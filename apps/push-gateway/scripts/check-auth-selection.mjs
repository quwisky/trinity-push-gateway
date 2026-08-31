import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const root = new URL('../../../', import.meta.url);
const packageFile = new URL('package.json', root);
const bundle = new URL('dist/apps/push-gateway/auth-selection/index.js', root);
const metafile = new URL(
  'dist/apps/push-gateway/auth-selection/meta.json',
  root,
);
const bunBundle = new URL('dist/apps/push-gateway/bun/main.js', root);
const bunMetafile = new URL('dist/apps/push-gateway/bun/meta.json', root);
const [
  packageJson,
  bundleBytes,
  { size },
  metadata,
  bunBytes,
  bunMetadata,
  bunStat,
] = await Promise.all([
  readFile(packageFile, 'utf8').then(JSON.parse),
  readFile(bundle),
  stat(bundle),
  readFile(metafile, 'utf8').then(JSON.parse),
  readFile(bunBundle),
  readFile(bunMetafile, 'utf8').then(JSON.parse),
  stat(bunBundle),
]);

const dependencies = packageJson.dependencies ?? {};
const devDependencies = packageJson.devDependencies ?? {};
if (dependencies['openid-client'] !== '6.8.7') {
  throw new Error('The selected OIDC dependency must be openid-client 6.8.7.');
}
if (devDependencies['oidc-provider'] !== '9.11.3') {
  throw new Error('The OIDC contract provider must be pinned to 9.11.3.');
}
const allDependencyNames = [
  ...Object.keys(dependencies),
  ...Object.keys(devDependencies),
];
const losingDependencies = allDependencyNames.filter(
  (name) => name === 'better-auth' || name.startsWith('@better-auth/'),
);
if (losingDependencies.length > 0) {
  throw new Error(
    `The losing authentication candidate remains installed: ${losingDependencies.join(', ')}.`,
  );
}
if (
  dependencies['oidc-provider'] !== undefined ||
  devDependencies['openid-client'] !== undefined
) {
  throw new Error(
    'openid-client must be production-only and oidc-provider must be test-only.',
  );
}

const inputs = Object.keys(metadata.inputs ?? {}).sort();
for (const required of ['openid-client@6.8.7', 'oauth4webapi@3.8.7']) {
  if (!inputs.some((input) => input.includes(required))) {
    throw new Error(`Authentication bundle is missing ${required}.`);
  }
}
const forbiddenInputs = inputs.filter((input) =>
  /better-auth|oidc-provider/u.test(input),
);
if (forbiddenInputs.length > 0) {
  throw new Error(
    `Authentication bundle contains a losing or test-only package: ${forbiddenInputs.join(', ')}.`,
  );
}

const bunInputs = Object.keys(bunMetadata.inputs ?? {}).sort();
if (!bunInputs.some((input) => input.endsWith('src/bun/main.ts'))) {
  throw new Error('The production Bun metafile is missing its entry point.');
}
const forbiddenBunInputs = bunInputs.filter((input) =>
  /better-auth|oidc-provider|(?:^|[/\\])test(?:[/\\]|$)|test-oidc-provider/u.test(
    input,
  ),
);
if (forbiddenBunInputs.length > 0) {
  throw new Error(
    `Production Bun bundle contains a losing or test-only input: ${forbiddenBunInputs.join(', ')}.`,
  );
}

const [gzipBytes, bunGzipBytes] = await Promise.all([
  gzipAsync(bundleBytes),
  gzipAsync(bunBytes),
]);
console.info(
  `Selected OIDC module: ${size} raw bytes; ${gzipBytes.byteLength} gzip bytes; ` +
    `${inputs.length} source inputs. Unwired Bun gateway baseline: ` +
    `${bunStat.size} raw bytes; ${bunGzipBytes.byteLength} gzip bytes; ` +
    `${bunInputs.length} production inputs.`,
);
