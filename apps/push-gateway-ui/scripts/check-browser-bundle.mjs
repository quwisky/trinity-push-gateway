import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const outputRoot = path.join(workspaceRoot, 'dist/apps/push-gateway-ui');
const browserRoot = path.join(outputRoot, 'browser');
const statsPath = path.join(outputRoot, 'stats.json');

const kibibyte = 1024;
const limits = {
  initialRaw: 384 * kibibyte,
  initialGzip: 128 * kibibyte,
  initialBrotli: 112 * kibibyte,
  scriptRaw: 224 * kibibyte,
  scriptGzip: 80 * kibibyte,
  scriptBrotli: 72 * kibibyte,
  totalRaw: 1024 * kibibyte,
  totalGzip: 320 * kibibyte,
  totalBrotli: 288 * kibibyte,
};

function assertBundle(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function collectFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function sizes(buffer) {
  const [gzipBuffer, brotliBuffer] = await Promise.all([
    gzipAsync(buffer, { level: 9 }),
    brotliAsync(buffer, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }),
  ]);
  return {
    raw: buffer.byteLength,
    gzip: gzipBuffer.byteLength,
    brotli: brotliBuffer.byteLength,
  };
}

function addSizes(left, right) {
  return {
    raw: left.raw + right.raw,
    gzip: left.gzip + right.gzip,
    brotli: left.brotli + right.brotli,
  };
}

function formatSizes(value) {
  return `${value.raw} raw / ${value.gzip} gzip / ${value.brotli} Brotli bytes`;
}

const browserFiles = await collectFiles(browserRoot);
assertBundle(
  browserFiles.length > 0,
  'The production browser output is empty.',
);

const forbiddenArtifact = browserFiles.find((filePath) =>
  /(?:\.map$|(?:^|\/)(?:ngsw(?:-worker)?\.js|ngsw\.json|manifest\.webmanifest|service-worker\.js)$)/u.test(
    filePath.split(path.sep).join('/'),
  ),
);
assertBundle(
  forbiddenArtifact === undefined,
  `Forbidden production artifact: ${path.relative(browserRoot, forbiddenArtifact ?? '')}.`,
);

const artifacts = new Map();
let totalSizes = { raw: 0, gzip: 0, brotli: 0 };
for (const filePath of browserFiles) {
  const relativePath = path
    .relative(browserRoot, filePath)
    .split(path.sep)
    .join('/');
  const buffer = await readFile(filePath);
  const artifactSizes = await sizes(buffer);
  artifacts.set(relativePath, { buffer, sizes: artifactSizes });
  totalSizes = addSizes(totalSizes, artifactSizes);

  if (relativePath.endsWith('.js')) {
    assertBundle(
      artifactSizes.raw <= limits.scriptRaw,
      `${relativePath} exceeds the raw per-script budget: ${formatSizes(artifactSizes)}.`,
    );
    assertBundle(
      artifactSizes.gzip <= limits.scriptGzip,
      `${relativePath} exceeds the gzip per-script budget: ${formatSizes(artifactSizes)}.`,
    );
    assertBundle(
      artifactSizes.brotli <= limits.scriptBrotli,
      `${relativePath} exceeds the Brotli per-script budget: ${formatSizes(artifactSizes)}.`,
    );
  }
}

assertBundle(
  totalSizes.raw <= limits.totalRaw,
  `Browser output exceeds the raw total budget: ${formatSizes(totalSizes)}.`,
);
assertBundle(
  totalSizes.gzip <= limits.totalGzip,
  `Browser output exceeds the gzip total budget: ${formatSizes(totalSizes)}.`,
);
assertBundle(
  totalSizes.brotli <= limits.totalBrotli,
  `Browser output exceeds the Brotli total budget: ${formatSizes(totalSizes)}.`,
);

const indexArtifact = artifacts.get('index.html');
assertBundle(
  indexArtifact !== undefined,
  'The production browser index is missing.',
);
const indexHtml = indexArtifact.buffer.toString('utf8');
assertBundle(
  /<base\s+href=["']\/admin\/["']/iu.test(indexHtml),
  'The production browser index must use /admin/ as its base href.',
);

const initialAssetNames = new Set();
for (const match of indexHtml.matchAll(
  /(?:src|href)=["']([^"']+\.(?:css|js))(?:\?[^"']*)?["']/giu,
)) {
  const assetName = match[1]
    .replace(/^\/admin\//u, '')
    .replace(/^\.\//u, '')
    .replace(/^\//u, '');
  initialAssetNames.add(assetName);
}
assertBundle(
  initialAssetNames.size > 0,
  'No initial browser assets were found in index.html.',
);

let initialSizes = { raw: 0, gzip: 0, brotli: 0 };
for (const assetName of initialAssetNames) {
  const artifact = artifacts.get(assetName);
  assertBundle(
    artifact !== undefined,
    `Initial browser asset is missing: ${assetName}.`,
  );
  initialSizes = addSizes(initialSizes, artifact.sizes);
}
assertBundle(
  initialSizes.raw <= limits.initialRaw,
  `Initial assets exceed the raw budget: ${formatSizes(initialSizes)}.`,
);
assertBundle(
  initialSizes.gzip <= limits.initialGzip,
  `Initial assets exceed the gzip budget: ${formatSizes(initialSizes)}.`,
);
assertBundle(
  initialSizes.brotli <= limits.initialBrotli,
  `Initial assets exceed the Brotli budget: ${formatSizes(initialSizes)}.`,
);

for (const [relativePath, { buffer }] of artifacts) {
  if (!relativePath.endsWith('.css') && relativePath !== 'index.html') {
    continue;
  }
  const text = buffer.toString('utf8');
  assertBundle(
    !/https?:\/\/|(?:src|href)\s*=\s*["']\/\//iu.test(text),
    `${relativePath} contains an external browser asset URL.`,
  );
  assertBundle(
    !/@font-face|rel=["']manifest["']/iu.test(text),
    `${relativePath} contains an icon/font or manifest asset.`,
  );
}

const stats = JSON.parse(await readFile(statsPath, 'utf8'));
assertBundle(
  stats.outputs && typeof stats.outputs === 'object',
  'Angular stats.json has no outputs.',
);
const outputEntries = Object.entries(stats.outputs);
const mainOutput = outputEntries.find(([, output]) =>
  output.entryPoint?.endsWith('apps/push-gateway-ui/src/main.ts'),
);
assertBundle(
  mainOutput !== undefined,
  'Angular stats.json has no browser main entry point.',
);

const initialOutputs = new Set();
const pendingOutputs = [mainOutput[0]];
while (pendingOutputs.length > 0) {
  const outputName = pendingOutputs.pop();
  if (initialOutputs.has(outputName)) {
    continue;
  }
  initialOutputs.add(outputName);
  const output = stats.outputs[outputName];
  assertBundle(
    output !== undefined,
    `stats.json references a missing output: ${outputName}.`,
  );
  for (const imported of output.imports ?? []) {
    if (imported.kind !== 'dynamic-import') {
      pendingOutputs.push(imported.path);
    }
  }
}

const isChartInput = (inputPath) =>
  inputPath.includes('/node_modules/chart.js/');
const isNgForgeInput = (inputPath) =>
  inputPath.includes('/node_modules/@ng-forge/dynamic-forms/');
const isUnusedNgForgeComponent = (inputPath) =>
  /ng-forge-dynamic-forms-(?:array|container|group|page|text)-field\.component|ng-forge-dynamic-forms-(?:css|row)-wrapper\.component/u.test(
    inputPath,
  );
const allInputPaths = outputEntries.flatMap(([, output]) =>
  Object.keys(output.inputs ?? {}),
);
assertBundle(
  allInputPaths.some(isChartInput),
  'The modular Chart.js wrapper is absent from the browser build.',
);
assertBundle(
  allInputPaths.some(isNgForgeInput),
  'The route-local ng-forge adapter is absent from the browser build.',
);
const unusedNgForgeComponents = allInputPaths.filter(isUnusedNgForgeComponent);
assertBundle(
  unusedNgForgeComponents.length === 0,
  `Unused ng-forge components entered the browser graph: ${unusedNgForgeComponents.join(', ')}.`,
);
assertBundle(
  !allInputPaths.some((inputPath) =>
    /\/node_modules\/chart\.js\/auto\//u.test(inputPath),
  ),
  'chart.js/auto is forbidden in the browser graph.',
);

for (const outputName of initialOutputs) {
  const inputs = Object.keys(stats.outputs[outputName]?.inputs ?? {});
  assertBundle(
    !inputs.some(isChartInput),
    `Chart.js leaked into the initial output graph through ${outputName}.`,
  );
  assertBundle(
    !inputs.some(isNgForgeInput),
    `ng-forge leaked into the initial output graph through ${outputName}.`,
  );
}

console.info(
  `UI browser bundle: initial ${formatSizes(initialSizes)}; total ${formatSizes(totalSizes)}; ` +
    `${initialOutputs.size} initial JavaScript outputs.`,
);
