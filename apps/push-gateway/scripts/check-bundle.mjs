import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const maximumRawBytes = 64 * 1024 * 1024;
const maximumGzipBytes = 3 * 1024 * 1024;
const allowedDependencyNames = ['drizzle-orm', 'jose', 'zod'];
const bundle = new URL(
  '../../../dist/apps/push-gateway/worker/index.js',
  import.meta.url,
);
const packageFile = new URL('../../../package.json', import.meta.url);
const [bundleBytes, { size }, packageJson] = await Promise.all([
  readFile(bundle),
  stat(bundle),
  readFile(packageFile, 'utf8').then(JSON.parse),
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
  JSON.stringify(dependencyNames) !== JSON.stringify(allowedDependencyNames)
) {
  throw new Error(
    `Runtime dependency names must exactly match the approved allowlist: ${allowedDependencyNames.join(', ')}.`,
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
    `runtime dependencies: ${dependencyNames.length} approved.`,
);
