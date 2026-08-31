import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  PUSH_GATEWAY_CONFIGURATION_CATALOG,
  SHARED_CONFIGURATION_DEFAULTS,
} from '../../apps/push-gateway/src/configuration-catalog';

describe('configuration documentation coverage', () => {
  it('keeps every deployment input inside the authoritative catalog', () => {
    const sources = [
      '../../compose.yml',
      '../../compose.admin.yml',
      '../../.env.self-host.example',
      '../../.env.self-host-admin.example',
    ].map((relativePath) =>
      readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
    );
    const deploymentNames = new Set(
      sources.flatMap(
        (source) =>
          source.match(/\bTRINITY_PUSH_GATEWAY_[A-Z][A-Z0-9_]*/gu) ?? [],
      ),
    );
    for (const name of deploymentNames) {
      const entry = PUSH_GATEWAY_CONFIGURATION_CATALOG.references.find(
        (candidate) => candidate.name === name,
      );
      expect(entry, `${name} must be catalog-owned`).toBeDefined();
      expect(
        entry?.runtimes.some(
          (runtime) => runtime === 'bun' || runtime === 'compose',
        ),
      ).toBe(true);
    }
  });

  it('keeps Cloudflare variables aligned with shared runtime defaults', () => {
    const wrangler = readFileSync(
      new URL('../../apps/push-gateway/wrangler.jsonc', import.meta.url),
      'utf8',
    );

    for (const [name, value] of Object.entries(SHARED_CONFIGURATION_DEFAULTS)) {
      expect(wrangler).toContain(`"${name}": "${value}"`);
    }
  });
});
