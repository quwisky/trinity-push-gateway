import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  providerMatrix,
  requireProviderGateResults,
  runProviderWorkflowCommand,
  selectProviderGatePlan,
} from './provider-gate-workflow.mjs';

test('provider selection preserves pull-request, schedule, and manual release policy', () => {
  assert.deepEqual(
    selectProviderGatePlan({
      baseRef: 'integration',
      changedPaths: ['docs/operations/administration.md'],
      eventName: 'pull_request',
    }),
    { deterministic: false, image: false, providers: [] },
  );
  assert.deepEqual(
    selectProviderGatePlan({
      baseRef: 'integration',
      changedPaths: ['apps/push-gateway/src/bun/auth/oidc-client.ts'],
      eventName: 'pull_request',
    }),
    { deterministic: true, image: true, providers: ['pocket-id'] },
  );
  assert.deepEqual(
    selectProviderGatePlan({
      baseRef: 'integration',
      changedPaths: ['apps/push-gateway/provider-e2e/pocket-id-adapter.mjs'],
      eventName: 'pull_request',
    }),
    {
      deterministic: true,
      image: true,
      providers: ['pocket-id', 'authentik'],
    },
  );
  assert.deepEqual(
    selectProviderGatePlan({
      baseRef: 'master',
      changedPaths: ['docs/architecture/provider-gates.md'],
      eventName: 'pull_request',
    }),
    { deterministic: false, image: true, providers: ['authentik'] },
  );
  assert.deepEqual(selectProviderGatePlan({ eventName: 'schedule' }), {
    deterministic: true,
    image: true,
    providers: ['pocket-id', 'authentik'],
  });
  assert.deepEqual(
    selectProviderGatePlan({
      eventName: 'workflow_dispatch',
      manualProvider: 'authentik',
    }),
    { deterministic: true, image: true, providers: ['authentik'] },
  );
  assert.throws(
    () =>
      selectProviderGatePlan({
        eventName: 'workflow_dispatch',
        manualProvider: 'unknown',
      }),
    /Unsupported provider selection/u,
  );
  assert.throws(
    () => selectProviderGatePlan({ eventName: 'push' }),
    /Unsupported provider workflow event/u,
  );
});

test('workflow selection command emits one matrix-safe plan', async (context) => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'provider-workflow-test-'),
  );
  context.after(() => rm(temporaryDirectory, { force: true, recursive: true }));
  const outputPath = path.join(temporaryDirectory, 'github-output');

  await runProviderWorkflowCommand('select', {
    EVENT_NAME: 'workflow_dispatch',
    GITHUB_OUTPUT: outputPath,
    MANUAL_PROVIDER: 'all',
  });

  const outputs = Object.fromEntries(
    (await readFile(outputPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  assert.deepEqual(JSON.parse(outputs.plan), {
    deterministic: true,
    image: true,
    providers: ['pocket-id', 'authentik'],
  });
  assert.deepEqual(JSON.parse(outputs.provider_matrix), [
    { displayName: 'Pocket ID', id: 'pocket-id', timeoutMinutes: 25 },
    { displayName: 'Authentik', id: 'authentik', timeoutMinutes: 40 },
  ]);
  assert.equal(outputs.deterministic, 'true');
  assert.equal(outputs.image, 'true');
});

test('provider matrix owns display names and timeout variance', () => {
  assert.deepEqual(providerMatrix({ providers: ['pocket-id', 'authentik'] }), [
    { displayName: 'Pocket ID', id: 'pocket-id', timeoutMinutes: 25 },
    { displayName: 'Authentik', id: 'authentik', timeoutMinutes: 40 },
  ]);
  assert.throws(
    () => providerMatrix({ providers: ['unknown'] }),
    /Unknown real provider/u,
  );
});

test('release aggregation requires every selected gate and ignores unselected gates', () => {
  const noProviders = {
    deterministic: false,
    image: false,
    providers: [],
  };
  assert.equal(
    requireProviderGateResults(noProviders, {
      classify: 'success',
      deterministic: 'skipped',
      image: 'skipped',
      providers: 'skipped',
    }),
    'Every selected provider and assembled-image gate passed.',
  );

  const allProviders = {
    deterministic: true,
    image: true,
    providers: ['pocket-id', 'authentik'],
  };
  const success = {
    classify: 'success',
    deterministic: 'success',
    image: 'success',
    providers: 'success',
  };
  assert.equal(
    requireProviderGateResults(allProviders, success),
    'Every selected provider and assembled-image gate passed.',
  );
  for (const gate of ['classify', 'deterministic', 'image', 'providers']) {
    assert.throws(
      () =>
        requireProviderGateResults(allProviders, {
          ...success,
          [gate]: 'failure',
        }),
      /finished as failure/u,
    );
  }
  assert.throws(
    () =>
      requireProviderGateResults({ ...allProviders, image: false }, success),
    /image selection is inconsistent/u,
  );
});
