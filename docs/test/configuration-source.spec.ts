import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { GATEWAY_CONFIGURATION_REFERENCE } from '../../apps/push-gateway/src/config-reference';

describe('configuration documentation coverage', () => {
  it('documents every configuration name accepted by code and Compose', () => {
    const sources = [
      '../../apps/push-gateway/src/config.ts',
      '../../apps/push-gateway/src/bun/config.ts',
      '../../apps/push-gateway/src/bun/main.ts',
      '../../compose.yml',
      '../../.env.self-host.example',
    ].map((relativePath) =>
      readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
    );
    const acceptedNames = new Set(
      sources.flatMap(
        (source) =>
          source.match(/\bTRINITY_PUSH_GATEWAY_[A-Z][A-Z0-9_]*/gu) ?? [],
      ),
    );
    const documentedNames = new Set(
      GATEWAY_CONFIGURATION_REFERENCE.map(({ name }) => name),
    );

    expect([...acceptedNames].sort()).toEqual([...documentedNames].sort());
  });
});
