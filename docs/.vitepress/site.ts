import { readFileSync } from 'node:fs';

import { PUSH_GATEWAY_CONFIGURATION_CATALOG } from '../../apps/push-gateway/src/configuration-catalog';

export type DocsChannel = 'latest' | 'next' | `v${number}.${number}.${number}`;

export type DocsBuildContext = Readonly<{
  base: string;
  canonical: boolean;
  channel: DocsChannel;
  label: string;
}>;

export type VersionsManifest = Readonly<{
  latest: string | null;
  versions: readonly string[];
}>;

export type TrinityThemeConfig = Readonly<{
  version: {
    channel: DocsChannel;
    label: string;
    manifestUrl: string;
    projectBase: string;
  };
}>;

type DocsEnvironment = Readonly<{
  TRINITY_DOCS_BASE?: string;
  TRINITY_DOCS_CHANNEL?: string;
}>;

const VERSION_PATTERN = /^v\d+\.\d+\.\d+$/u;
const PROJECT_BASE_PATTERN =
  /^\/trinity-push-gateway\/(?:latest|next|v\d+\.\d+\.\d+)\/$/u;
const LATEST_ORIGIN = 'https://quwisky.github.io/trinity-push-gateway/latest/';

export function canonicalDocumentationUrl(relativePath: string): string {
  const route = relativePath
    .replace(/(^|\/)index\.md$/u, '$1')
    .replace(/\.md$/u, '');
  return new URL(route, LATEST_ORIGIN).href;
}

function docsChannel(value: string): DocsChannel {
  if (value === 'latest' || value === 'next' || VERSION_PATTERN.test(value)) {
    return value as DocsChannel;
  }
  throw new Error(
    'TRINITY_DOCS_CHANNEL must be latest, next, or an immutable vX.Y.Z version.',
  );
}

export function docsBuildContext(
  environment: DocsEnvironment,
): DocsBuildContext {
  const channel = docsChannel(environment.TRINITY_DOCS_CHANNEL ?? 'next');
  const base = environment.TRINITY_DOCS_BASE ?? '/';
  if (base !== '/' && !PROJECT_BASE_PATTERN.test(base)) {
    throw new Error(
      'TRINITY_DOCS_BASE must stay within the trinity-push-gateway Pages path.',
    );
  }
  if (base !== '/' && !base.endsWith(`/${channel}/`)) {
    throw new Error('TRINITY_DOCS_BASE must match TRINITY_DOCS_CHANNEL.');
  }
  return {
    base,
    canonical: channel === 'latest',
    channel,
    label:
      channel === 'next' ? 'Next' : channel === 'latest' ? 'Latest' : channel,
  };
}

function tableCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderConfigurationReference(): string {
  const header = [
    '| Setting | Runtime | Required | Secret | Default | Constraint | Description |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  const rows = PUSH_GATEWAY_CONFIGURATION_CATALOG.references()
    .map((entry) =>
      [
        `\`${entry.name}\``,
        entry.runtimes.join(', '),
        entry.required ? 'Yes' : 'No',
        entry.secret ? 'Secret' : 'No',
        entry.defaultValue === undefined || entry.defaultValue.length === 0
          ? '—'
          : `\`${entry.defaultValue}\``,
        entry.constraint ?? '—',
        entry.description,
      ]
        .map(tableCell)
        .join(' | '),
    )
    .map((row) => `| ${row} |`);
  return [...header, ...rows].join('\n');
}

export function normalizeRootChangelog(markdown: string): string {
  return markdown
    .replace(/^# Changelog[ \t]*(?:\r?\n|$)/u, '')
    .replace(/^## Changelog[ \t]*(?:\r?\n|$)/mu, '')
    .trim();
}

export function renderRootChangelog(): string {
  return normalizeRootChangelog(
    readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'),
  );
}
