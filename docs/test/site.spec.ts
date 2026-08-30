import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  canonicalDocumentationUrl,
  docsBuildContext,
  normalizeRootChangelog,
  renderConfigurationReference,
} from '../.vitepress/site';

describe('documentation build context', () => {
  it('describes the rolling next channel at the project Pages path', () => {
    expect(
      docsBuildContext({
        TRINITY_DOCS_BASE: '/trinity-push-gateway/next/',
        TRINITY_DOCS_CHANNEL: 'next',
      }),
    ).toEqual({
      base: '/trinity-push-gateway/next/',
      canonical: false,
      channel: 'next',
      label: 'Next',
    });
  });

  it('accepts latest and immutable semantic versions only', () => {
    expect(
      docsBuildContext({
        TRINITY_DOCS_BASE: '/trinity-push-gateway/latest/',
        TRINITY_DOCS_CHANNEL: 'latest',
      }),
    ).toMatchObject({ canonical: true, label: 'Latest' });
    expect(
      docsBuildContext({
        TRINITY_DOCS_BASE: '/trinity-push-gateway/v1.2.3/',
        TRINITY_DOCS_CHANNEL: 'v1.2.3',
      }),
    ).toMatchObject({ canonical: false, label: 'v1.2.3' });
    expect(() =>
      docsBuildContext({
        TRINITY_DOCS_BASE: '/trinity-push-gateway/latest/',
        TRINITY_DOCS_CHANNEL: 'main',
      }),
    ).toThrow('TRINITY_DOCS_CHANNEL');
  });

  it('rejects a base path that can escape the project Pages site', () => {
    expect(() =>
      docsBuildContext({
        TRINITY_DOCS_BASE: 'https://example.test/',
        TRINITY_DOCS_CHANNEL: 'next',
      }),
    ).toThrow('TRINITY_DOCS_BASE');
  });

  it('points every channel at the equivalent latest canonical page', () => {
    expect(canonicalDocumentationUrl('index.md')).toBe(
      'https://quwisky.github.io/trinity-push-gateway/latest/',
    );
    expect(canonicalDocumentationUrl('operations/index.md')).toBe(
      'https://quwisky.github.io/trinity-push-gateway/latest/operations/',
    );
    expect(canonicalDocumentationUrl('reference/configuration.md')).toBe(
      'https://quwisky.github.io/trinity-push-gateway/latest/reference/configuration',
    );
  });
});

describe('configuration reference rendering', () => {
  it('renders public metadata for every setting without secret values', () => {
    const markdown = renderConfigurationReference();

    expect(markdown).toContain('TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY');
    expect(markdown).toContain('Secret');
    expect(markdown).toContain('65536');
    expect(markdown).not.toContain('-----BEGIN PRIVATE KEY-----');
    expect(markdown).not.toContain('gateway@example.test');
  });
});

describe('changelog rendering', () => {
  it('keeps generated releases without duplicating the page heading', () => {
    const generated = readFileSync(
      new URL('./fixtures/release-changelog.md.fixture', import.meta.url),
      'utf8',
    );

    const rendered = normalizeRootChangelog(generated);

    expect(rendered).toContain('## 0.1.0 (2026-08-30)');
    expect(rendered).toContain(
      'Release Please generates versioned entries from Conventional Commit history.',
    );
    expect(rendered).not.toMatch(/^#{1,6} Changelog$/mu);
  });
});

describe('Pages publication trigger', () => {
  it('publishes master only after the CI workflow succeeds', () => {
    const workflow = readFileSync(
      new URL('../../.github/workflows/pages.yml', import.meta.url),
      'utf8',
    );

    expect(workflow).toContain('workflow_run:');
    expect(workflow).toContain('workflows: [CI]');
    expect(workflow).not.toContain('workflow_dispatch');
  });

  it('deploys an assembled site when the release build is intentionally skipped', () => {
    const workflow = readFileSync(
      new URL('../../.github/workflows/pages.yml', import.meta.url),
      'utf8',
    );

    expect(workflow).toContain(
      "deploy:\n    name: Deploy GitHub Pages\n    if: >-\n      always() && needs.assemble.result == 'success'",
    );
  });
});
