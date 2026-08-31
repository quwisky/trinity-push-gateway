import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const maximumRawBytes = 64 * 1024 * 1024;
const maximumGzipBytes = 3 * 1024 * 1024;
const allowedWorkspaceDependencyNames = [
  'drizzle-orm',
  'jose',
  'openid-client',
  'zod',
];
const expectedSourceCount = 103;
const expectedSourceGraph =
  'f114f64628e2ac16a709ea20d5c6ae8c79429df1c79fb4fd33a78c3e9ec54d21';
const bundle = new URL(
  '../../../dist/apps/push-gateway/worker/index.js',
  import.meta.url,
);
const sourceMap = new URL(
  '../../../dist/apps/push-gateway/worker/index.js.map',
  import.meta.url,
);
const packageFile = new URL('../../../package.json', import.meta.url);
const [bundleBytes, { size }, packageJson, sourceMapJson] = await Promise.all([
  readFile(bundle),
  stat(bundle),
  readFile(packageFile, 'utf8').then(JSON.parse),
  readFile(sourceMap, 'utf8').then(JSON.parse),
]);
const gzipBytes = (await gzipAsync(bundleBytes)).byteLength;
const bundleText = bundleBytes.toString('utf8');

for (const forbiddenRuntime of ['bun:sqlite', 'drizzle-orm/bun-sqlite']) {
  if (bundleText.includes(forbiddenRuntime)) {
    throw new Error(
      `Worker bundle must not include the Bun storage adapter: ${forbiddenRuntime}.`,
    );
  }
}

if (
  !Array.isArray(sourceMapJson.sources) ||
  !sourceMapJson.sources.every((source) => typeof source === 'string')
) {
  throw new Error('Worker source map does not contain a valid source graph.');
}
const normalizedSources = sourceMapJson.sources
  .map((source) =>
    source
      .replace(
        /^.*?node_modules\/\.pnpm\/[^/]+\/node_modules\//u,
        'node_modules/',
      )
      .replace(/^\.\.\/\.\.\/\.\.\/\.\.\//u, ''),
  )
  .sort();
const forbiddenWorkerSources = normalizedSources.filter((source) =>
  /better-auth|oauth4webapi|oidc-provider|openid-client|src\/bun\//u.test(
    source,
  ),
);
if (forbiddenWorkerSources.length > 0) {
  throw new Error(
    `Worker source graph contains Bun-only authentication code: ${forbiddenWorkerSources.join(', ')}.`,
  );
}
const sourceGraph = createHash('sha256')
  .update(normalizedSources.join('\n'))
  .digest('hex');
if (
  normalizedSources.length !== expectedSourceCount ||
  sourceGraph !== expectedSourceGraph
) {
  throw new Error(
    `Worker source graph changed: ${normalizedSources.length} inputs, ${sourceGraph}.`,
  );
}

if (size > maximumRawBytes) {
  throw new Error(
    `Worker bundle is ${size} raw bytes; Free-plan limit is ${maximumRawBytes}.`,
  );
}
if (gzipBytes > maximumGzipBytes) {
  throw new Error(
    `Worker bundle is ${gzipBytes} gzip bytes; Free-plan limit is ${maximumGzipBytes}.`,
  );
}
const dependencies = packageJson.dependencies ?? {};
const dependencyNames = Object.keys(dependencies).sort();
if (
  JSON.stringify(dependencyNames) !==
  JSON.stringify(allowedWorkspaceDependencyNames)
) {
  throw new Error(
    `Workspace runtime dependency names must exactly match the approved allowlist: ${allowedWorkspaceDependencyNames.join(', ')}.`,
  );
}
for (const [name, version] of Object.entries(dependencies)) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`${name} must use an exact semantic-version pin.`);
  }
}

const rawPercentage = ((size / maximumRawBytes) * 100).toFixed(2);
const gzipPercentage = ((gzipBytes / maximumGzipBytes) * 100).toFixed(2);

console.info(
  `Worker bundle: ${size} raw bytes (${rawPercentage}% of Free-plan limit); ` +
    `${gzipBytes} gzip bytes (${gzipPercentage}%); ` +
    `workspace runtime dependencies: ${dependencyNames.length} approved; ` +
    `source graph: ${normalizedSources.length} unchanged inputs.`,
);
