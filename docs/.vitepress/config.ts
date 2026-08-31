import { defineConfigWithTheme, type DefaultTheme } from 'vitepress';

import {
  canonicalDocumentationUrl,
  docsBuildContext,
  renderConfigurationReference,
  renderRootChangelog,
  type TrinityThemeConfig,
} from './site';

const context = docsBuildContext(process.env);
const repository = 'https://github.com/quwisky/trinity-push-gateway';
const sourceRef = process.env.TRINITY_DOCS_SOURCE_REF ?? 'master';

export default defineConfigWithTheme<DefaultTheme.Config & TrinityThemeConfig>({
  base: context.base,
  description:
    'Deploy and operate the privacy-preserving Matrix push gateway for Trinity.',
  head: [
    ['meta', { name: 'theme-color', content: '#6d55d9' }],
    ...(context.canonical
      ? []
      : [
          ['meta', { name: 'robots', content: 'noindex,follow' }] as [
            string,
            Record<string, string>,
          ],
        ]),
  ],
  lang: 'en-US',
  lastUpdated: true,
  markdown: {
    config(markdown) {
      const renderHtmlBlock = markdown.renderer.rules.html_block;
      markdown.renderer.rules.html_block = (
        tokens,
        index,
        options,
        environment,
        self,
      ) => {
        if (
          tokens[index]?.content.trim() === '<!-- configuration-reference -->'
        ) {
          return markdown.render(renderConfigurationReference(), environment);
        }
        if (tokens[index]?.content.trim() === '<!-- root-changelog -->') {
          return markdown.render(renderRootChangelog(), environment);
        }
        return (
          renderHtmlBlock?.(tokens, index, options, environment, self) ?? ''
        );
      };
    },
  },
  outDir: process.env.TRINITY_DOCS_OUT_DIR ?? '../dist/docs/push-gateway-docs',
  sitemap: context.canonical
    ? { hostname: 'https://quwisky.github.io/trinity-push-gateway/latest/' }
    : undefined,
  srcExclude: ['agents/**'],
  themeConfig: {
    editLink: {
      pattern: `${repository}/edit/${sourceRef}/docs/:path`,
      text:
        context.channel === 'next'
          ? 'Edit this page on GitHub'
          : 'Suggest a correction on GitHub',
    },
    footer: {
      copyright: 'Copyright © Trinity Push Gateway contributors',
      message: 'Released under the Apache-2.0 License.',
    },
    nav: [
      { text: 'Guide', link: '/getting-started/' },
      { text: 'Operations', link: '/operations/' },
      { text: 'Reference', link: '/reference/configuration' },
      { text: context.label, link: '/versions/' },
    ],
    outline: { level: [2, 3], label: 'On this page' },
    search: { provider: 'local' },
    sidebar: [
      {
        text: 'Getting started',
        items: [{ text: 'Choose a deployment', link: '/getting-started/' }],
      },
      {
        text: 'Deployment',
        items: [
          { text: 'Cloudflare', link: '/deployment/cloudflare/' },
          { text: 'Docker and Bun', link: '/deployment/self-hosting/' },
          {
            text: 'Administration UI',
            link: '/deployment/self-hosting/administration',
          },
        ],
      },
      {
        text: 'Operations',
        items: [
          { text: 'Operate the gateway', link: '/operations/' },
          {
            text: 'Administration operations',
            link: '/operations/administration',
          },
          {
            text: 'Backup and restore',
            link: '/operations/backup-and-restore',
          },
          { text: 'Upgrade and rollback', link: '/operations/upgrades' },
          { text: 'Troubleshooting', link: '/operations/troubleshooting' },
        ],
      },
      {
        text: 'Integration',
        items: [{ text: 'Matrix push contract', link: '/integration/matrix' }],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Configuration', link: '/reference/configuration' },
          { text: 'Releases', link: '/reference/releases' },
          { text: 'Changelog', link: '/reference/changelog' },
        ],
      },
      {
        text: 'Architecture',
        items: [
          { text: 'System design', link: '/architecture/' },
          { text: 'Decision records', link: '/architecture/adr/' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: repository }],
    version: {
      channel: context.channel,
      label: context.label,
      manifestUrl: '/trinity-push-gateway/versions.json',
      projectBase: '/trinity-push-gateway/',
    },
  },
  title: 'Trinity Push Gateway',
  transformHead({ pageData }) {
    return [
      [
        'link',
        {
          href: canonicalDocumentationUrl(pageData.relativePath),
          rel: 'canonical',
        },
      ],
    ];
  },
  vite: {
    build: { target: 'es2022' },
    esbuild: {
      target: 'es2022',
      tsconfigRaw: { compilerOptions: { target: 'ES2022' } },
    },
  },
});
