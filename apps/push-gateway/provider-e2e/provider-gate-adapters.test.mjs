import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  realProviderAdapter,
  realProviderIds,
  realProviderMatrixEntry,
} from './provider-gate-adapters.mjs';

test('the real-provider registry excludes the deterministic mock adapter', () => {
  assert.deepEqual(realProviderIds, ['pocket-id', 'authentik']);
  assert.equal(realProviderAdapter('pocket-id').displayName, 'Pocket ID');
  assert.equal(realProviderAdapter('authentik').displayName, 'Authentik');
  assert.deepEqual(realProviderMatrixEntry('pocket-id'), {
    displayName: 'Pocket ID',
    id: 'pocket-id',
    timeoutMinutes: 25,
  });
  assert.deepEqual(realProviderMatrixEntry('authentik'), {
    displayName: 'Authentik',
    id: 'authentik',
    timeoutMinutes: 40,
  });
  assert.throws(
    () => realProviderAdapter('mock-oidc'),
    /Unknown real provider/u,
  );
});
