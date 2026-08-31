import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  realProviderIds,
  realProviderMatrixEntry,
} from './provider-gate-adapters.mjs';

const DETERMINISTIC_PATH =
  /^(?:apps\/push-gateway\/|package\.json$|pnpm-lock\.yaml$|\.github\/workflows\/provider-compatibility\.yml$)/u;
const POCKET_ID_PATH =
  /^(?:apps\/push-gateway\/(?:provider-e2e\/|src\/bun\/(?:admin|auth)\/|scripts\/test-oidc-provider\.mjs)|package\.json$|pnpm-lock\.yaml$|\.github\/workflows\/provider-compatibility\.yml$)/u;
const AUTHENTIK_PATH =
  /^(?:apps\/push-gateway\/provider-e2e\/|\.github\/workflows\/provider-compatibility\.yml$)/u;

function requiredValue(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function selectedProviderIds({
  baseRef = '',
  changedPaths = [],
  eventName,
  manualProvider = '',
}) {
  if (eventName === 'schedule') {
    return ['pocket-id', 'authentik'];
  }
  if (eventName === 'workflow_dispatch') {
    if (!['all', ...realProviderIds].includes(manualProvider)) {
      throw new Error(`Unsupported provider selection: ${manualProvider}.`);
    }
    return manualProvider === 'all'
      ? ['pocket-id', 'authentik']
      : [manualProvider];
  }
  if (eventName !== 'pull_request') {
    throw new Error(`Unsupported provider workflow event: ${eventName}.`);
  }

  const pocketId = changedPaths.some((changedPath) =>
    POCKET_ID_PATH.test(changedPath),
  );
  const authentik =
    baseRef === 'master' ||
    changedPaths.some((changedPath) => AUTHENTIK_PATH.test(changedPath));
  return [
    ...(pocketId ? ['pocket-id'] : []),
    ...(authentik ? ['authentik'] : []),
  ];
}

export function selectProviderGatePlan(input) {
  const changedPaths = input.changedPaths ?? [];
  const providerIds = selectedProviderIds(input);
  const deterministic =
    input.eventName !== 'pull_request' ||
    changedPaths.some((changedPath) => DETERMINISTIC_PATH.test(changedPath));
  return Object.freeze({
    deterministic,
    image: providerIds.length > 0,
    providers: Object.freeze(providerIds),
  });
}

export function providerMatrix(plan) {
  return plan.providers.map(realProviderMatrixEntry);
}

export function requireProviderGateResults(plan, results) {
  if (results.classify !== 'success') {
    throw new Error(`Provider classification finished as ${results.classify}.`);
  }
  const selected = [
    ...(plan.deterministic ? [['Deterministic', results.deterministic]] : []),
    ...(plan.image ? [['Image', results.image]] : []),
    ...(plan.providers.length > 0 ? [['Providers', results.providers]] : []),
  ];
  if (plan.image !== plan.providers.length > 0) {
    throw new Error('Provider plan image selection is inconsistent.');
  }
  for (const [name, result] of selected) {
    if (result !== 'success') {
      throw new Error(`${name} gate was selected but finished as ${result}.`);
    }
  }
  return 'Every selected provider and assembled-image gate passed.';
}

function changedPaths(baseSha, headSha) {
  return execFileSync(
    'git',
    ['diff', '--name-only', `${baseSha}...${headSha}`],
    {
      encoding: 'utf8',
    },
  )
    .split('\n')
    .filter(Boolean);
}

async function writeOutputs(outputPath, entries) {
  const output = Object.entries(entries)
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');
  await appendFile(outputPath, `${output}\n`);
}

async function selectCommand(environment) {
  const eventName = requiredValue(environment.EVENT_NAME, 'EVENT_NAME');
  const plan = selectProviderGatePlan({
    baseRef: environment.BASE_REF ?? '',
    changedPaths:
      eventName === 'pull_request'
        ? changedPaths(
            requiredValue(environment.PR_BASE_SHA, 'PR_BASE_SHA'),
            requiredValue(environment.PR_HEAD_SHA, 'PR_HEAD_SHA'),
          )
        : [],
    eventName,
    manualProvider: environment.MANUAL_PROVIDER ?? '',
  });
  await writeOutputs(
    requiredValue(environment.GITHUB_OUTPUT, 'GITHUB_OUTPUT'),
    {
      deterministic: String(plan.deterministic),
      image: String(plan.image),
      plan: JSON.stringify(plan),
      provider_matrix: JSON.stringify(providerMatrix(plan)),
    },
  );
  console.info(
    `Selected gates: deterministic=${String(plan.deterministic)} providers=${plan.providers.join(',') || 'none'} image=${String(plan.image)}`,
  );
}

function requireCommand(environment) {
  const message = requireProviderGateResults(
    JSON.parse(requiredValue(environment.PROVIDER_PLAN, 'PROVIDER_PLAN')),
    {
      classify: environment.CLASSIFY_RESULT,
      deterministic: environment.DETERMINISTIC_RESULT,
      image: environment.IMAGE_RESULT,
      providers: environment.PROVIDERS_RESULT,
    },
  );
  console.info(message);
}

export async function runProviderWorkflowCommand(
  command,
  environment = process.env,
) {
  if (command === 'select') {
    await selectCommand(environment);
    return;
  }
  if (command === 'require') {
    requireCommand(environment);
    return;
  }
  throw new Error('Usage: provider-gate-workflow.mjs <select|require>');
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  await runProviderWorkflowCommand(process.argv[2]);
}
