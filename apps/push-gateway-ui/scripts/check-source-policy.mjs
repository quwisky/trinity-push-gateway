import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sourceRoot = path.join(projectRoot, 'src');

function assertPolicy(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function collectSourceFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath)));
    } else if (/\.(?:css|html|scss|svg|ts)$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

const sourceFiles = await collectSourceFiles(sourceRoot);
const sources = await Promise.all(
  sourceFiles.map(async (filePath) => ({
    filePath,
    relativePath: path
      .relative(projectRoot, filePath)
      .split(path.sep)
      .join('/'),
    source: await readFile(filePath, 'utf8'),
  })),
);
const runtimeSources = sources.filter(
  ({ relativePath }) =>
    !relativePath.endsWith('.spec.ts') && !relativePath.endsWith('.test.ts'),
);

const globalStyles = await readFile(
  path.join(sourceRoot, 'styles.scss'),
  'utf8',
);
for (const marker of [
  '.spartan-button {',
  '.spartan-checkbox {',
  '.spartan-input {',
  '.spartan-label {',
  '.spartan-native-select {',
]) {
  assertPolicy(
    globalStyles.includes(marker),
    `The app-owned Spartan style recipe is missing: ${marker}`,
  );
}

const productionCss = runtimeSources.find(({ relativePath }) =>
  relativePath.endsWith('.css'),
);
assertPolicy(
  productionCss === undefined,
  `Production UI styles must use SCSS; found ${productionCss?.relativePath ?? 'CSS source'}.`,
);

const appConfig = await readFile(
  path.join(sourceRoot, 'app/app.config.ts'),
  'utf8',
);
assertPolicy(
  /provideZonelessChangeDetection\(\)/u.test(appConfig),
  'The UI must explicitly provide zoneless change detection.',
);

const forbiddenSources = [
  ['Zone.js', /(?:from\s+['"]zone\.js|['"]zone\.js(?:\/testing)?['"])/u],
  ['Angular sanitizer bypass', /\b(?:DomSanitizer|bypassSecurityTrust\w*)\b/u],
  ['raw innerHTML binding', /(?:\[innerHTML\]|\.innerHTML\s*=)/u],
  ['dynamic code evaluation', /\b(?:eval|Function)\s*\(/u],
  [
    'direct browser networking outside generated HttpClient services',
    /\b(?:EventSource|WebSocket|XMLHttpRequest|fetch)\s*\(|navigator\.sendBeacon\s*\(/u,
  ],
  [
    'service worker',
    /\b(?:navigator\.serviceWorker|ServiceWorkerModule|provideServiceWorker|ngsw-config)\b/u,
  ],
  ['web manifest', /<link\b[^>]*\brel\s*=\s*['"]manifest['"]/iu],
  ['external asset URL', /https?:\/\/|(?:src|href)\s*=\s*['"]\/\//iu],
  ['icon font', /@font-face|material-icons|fontawesome/iu],
  [
    'browser analytics',
    /\bgtag\s*\(|googletagmanager|google-analytics|mixpanel|plausible\.io|posthog|segment\.com/iu,
  ],
  ['Chart.js auto registration', /chart\.js\/auto|\bregisterables\b/u],
  ['Chart.js date adapter', /chartjs-adapter/u],
  ['Angular Chart.js wrapper', /\b(?:ng2-charts|angular-chart)\b/u],
  [
    'bundle-expanding Zod namespace import',
    /import\s+(?:\*\s+as\s+\w+|\{\s*z\s*\})\s+from\s*['"]zod\/mini['"]/u,
  ],
  [
    'alternate ng-forge adapter',
    /@ng-forge\/dynamic-forms-(?:bootstrap|ionic|material|primeng)/u,
  ],
  [
    'mobile-client configuration',
    /\b(?:FirebaseMessaging|GoogleService-Info\.plist|google-services\.json|ovh\.qwky\.trinity)\b/u,
  ],
];

for (const [description, pattern] of forbiddenSources) {
  const violation = runtimeSources.find(({ source }) => pattern.test(source));
  assertPolicy(
    violation === undefined,
    `${description} is forbidden in ${violation?.relativePath ?? 'UI source'}.`,
  );
}

const chartSource = await readFile(
  path.join(sourceRoot, 'app/features/metrics/gateway-chart.ts'),
  'utf8',
);
const chartImport = chartSource.match(
  /import\s*\{(?<imports>[^}]*)\}\s*from\s*['"]chart\.js['"]/u,
);
assertPolicy(
  chartImport?.groups?.['imports'] !== undefined,
  'The direct Chart.js import is missing.',
);
const importedChartSymbols = chartImport.groups.imports
  .split(',')
  .map((symbol) => symbol.trim())
  .filter(Boolean)
  .sort();
const expectedChartSymbols = [
  'BarController',
  'BarElement',
  'CategoryScale',
  'Chart',
  'Legend',
  'LinearScale',
  'LineController',
  'LineElement',
  'PointElement',
  'Tooltip',
].sort();
assertPolicy(
  JSON.stringify(importedChartSymbols) === JSON.stringify(expectedChartSymbols),
  `Chart.js imports changed: ${importedChartSymbols.join(', ')}.`,
);

const chartRegistration = chartSource.match(
  /Chart\.register\((?<registrations>[\s\S]*?)\);/u,
);
assertPolicy(
  chartRegistration?.groups?.['registrations'] !== undefined,
  'The modular Chart.js registration is missing.',
);
const registeredChartSymbols = chartRegistration.groups.registrations
  .split(',')
  .map((symbol) => symbol.trim())
  .filter(Boolean)
  .sort();
assertPolicy(
  JSON.stringify(registeredChartSymbols) ===
    JSON.stringify(expectedChartSymbols.filter((symbol) => symbol !== 'Chart')),
  `Chart.js registrations changed: ${registeredChartSymbols.join(', ')}.`,
);

const formProviderPath = path.join(
  sourceRoot,
  'app/ui/form/spartan-form.provider.ts',
);
const formProvider = await readFile(formProviderPath, 'utf8');
const registeredFields = [
  ...formProvider.matchAll(/\bname:\s*'([^']+)'/gu),
].map(([, fieldName]) => fieldName);
const expectedFields = ['input', 'datetime', 'select', 'checkbox', 'submit'];
assertPolicy(
  JSON.stringify(registeredFields) === JSON.stringify(expectedFields),
  `Spartan form registrations changed: ${registeredFields.join(', ')}.`,
);
for (const route of ['metrics', 'operations', 'security']) {
  const routeSource = await readFile(
    path.join(sourceRoot, `app/features/${route}/${route}.routes.ts`),
    'utf8',
  );
  assertPolicy(
    /providers:\s*\[[^\]]*provideSpartanDynamicForm\(\)/u.test(routeSource),
    `The ng-forge registry must remain local to the lazy ${route} route.`,
  );
}

const workspaceConfiguration = await readFile(
  path.join(workspaceRoot, 'pnpm-workspace.yaml'),
  'utf8',
);
const ngForgePatchPath = 'patches/@ng-forge__dynamic-forms@1.1.0.patch';
assertPolicy(
  workspaceConfiguration.includes(ngForgePatchPath),
  'The ng-forge minimal-registry compatibility patch is not configured.',
);
const ngForgePatch = await readFile(
  path.join(workspaceRoot, ngForgePatchPath),
  'utf8',
);
for (const registry of [
  'BUILT_IN_ADDON_TYPES',
  'BUILT_IN_FIELDS',
  'BUILT_IN_WRAPPERS',
]) {
  assertPolicy(
    ngForgePatch.includes(`+const ${registry} = [];`),
    `The ng-forge compatibility patch no longer empties ${registry}.`,
  );
}
assertPolicy(
  ngForgePatch.includes('Promise.resolve(undefined)'),
  'The unused ng-forge paged-form loader is no longer disabled.',
);

for (const { relativePath, source } of sources) {
  if (!source.includes('@ng-forge/')) {
    continue;
  }
  assertPolicy(
    relativePath.startsWith('src/app/ui/form/') ||
      relativePath.startsWith('src/app/ui/confirmation/') ||
      relativePath.startsWith('src/app/features/metrics/') ||
      relativePath.startsWith('src/app/features/operations/') ||
      relativePath.startsWith('src/app/features/security/'),
    `ng-forge must remain in shared lazy form code or a form-bearing lazy route; found an import in ${relativePath}.`,
  );
}

for (const { relativePath, source } of runtimeSources) {
  if (!source.includes("from 'chart.js'")) {
    continue;
  }
  assertPolicy(
    relativePath.startsWith('src/app/features/metrics/'),
    `Chart.js must remain confined to the lazy Metrics route; found an import in ${relativePath}.`,
  );
}

const projectConfiguration = JSON.parse(
  await readFile(path.join(projectRoot, 'project.json'), 'utf8'),
);
const buildOptions = projectConfiguration.targets?.build?.options;
const productionOptions =
  projectConfiguration.targets?.build?.configurations?.production;
assertPolicy(
  buildOptions?.baseHref === '/admin/',
  'The production base href must be /admin/.',
);
assertPolicy(
  productionOptions?.sourceMap === false,
  'Production browser source maps must be explicitly disabled.',
);
assertPolicy(
  productionOptions?.statsJson === true,
  'The production build must emit stats.json for bundle-policy checks.',
);
assertPolicy(
  projectConfiguration.targets?.build?.options?.serviceWorker === undefined,
  'The UI must not configure a service worker.',
);

const workspacePackage = JSON.parse(
  await readFile(path.join(workspaceRoot, 'package.json'), 'utf8'),
);
const packageNames = new Set([
  ...Object.keys(workspacePackage.dependencies ?? {}),
  ...Object.keys(workspacePackage.devDependencies ?? {}),
]);
const forbiddenPackages = [
  '@angular/fire',
  '@angular/service-worker',
  '@spartan-ng/cli',
  'angular-google-analytics',
  'chartjs-adapter-date-fns',
  'chartjs-adapter-luxon',
  'firebase',
  'ng2-charts',
  'posthog-js',
];
const forbiddenPackage = forbiddenPackages.find((name) =>
  packageNames.has(name),
);
assertPolicy(
  forbiddenPackage === undefined,
  `Forbidden UI package is installed: ${forbiddenPackage}.`,
);

console.info(
  `UI source policy: ${sourceFiles.length} files, zoneless, route-local forms, and modular charts.`,
);
