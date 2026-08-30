import { readFile, stat } from 'node:fs/promises';

const maximumBytes = 100 * 1024;
const bundle = new URL('../dist/index.js', import.meta.url);
const packageFile = new URL('../package.json', import.meta.url);
const [{ size }, packageJson] = await Promise.all([
  stat(bundle),
  readFile(packageFile, 'utf8').then(JSON.parse),
]);

if (size > maximumBytes) {
  throw new Error(`Worker bundle is ${size} bytes; limit is ${maximumBytes}.`);
}
if (
  packageJson.dependencies !== undefined &&
  Object.keys(packageJson.dependencies).length > 0
) {
  throw new Error('Runtime dependencies are not allowed.');
}

console.info(`Worker bundle: ${size} bytes; runtime dependencies: 0.`);
