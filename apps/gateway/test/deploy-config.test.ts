import { describe, expect, it } from 'vitest';
import committedConfig from '../wrangler.jsonc?raw';
import {
  DeployConfigError,
  KV_ID_PLACEHOLDER,
  readDeployInputs,
  renderDeployConfig,
} from '../scripts/deploy-config';

const KV_ID = '40d296832ede4b1197623a4e1a158b3e';

describe('readDeployInputs', () => {
  it('reads and normalises both values', () => {
    expect(
      readDeployInputs({
        KV_NAMESPACE_ID: ` ${KV_ID.toUpperCase()} `,
        GATEWAY_DOMAIN: ' Push.TrinityProject.dev ',
      }),
    ).toEqual({ kvNamespaceId: KV_ID, domain: 'push.trinityproject.dev' });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['the placeholder', KV_ID_PLACEHOLDER],
    ['too short', 'abc123'],
    ['not hex', 'z'.repeat(32)],
  ])('rejects a KV namespace ID that is %s', (_, value) => {
    expect(() =>
      readDeployInputs({
        KV_NAMESPACE_ID: value,
        GATEWAY_DOMAIN: 'push.example.org',
      }),
    ).toThrow(
      expect.objectContaining({
        constructor: DeployConfigError,
        message: expect.stringContaining('KV_NAMESPACE_ID'),
      }),
    );
  });

  it.each([
    ['missing', undefined],
    ['a URL with a scheme', 'https://push.example.org'],
    ['a URL with a path', 'push.example.org/notify'],
    ['a single label', 'localhost'],
    ['a label starting with a hyphen', '-push.example.org'],
  ])('rejects a domain that is %s', (_, value) => {
    expect(() =>
      readDeployInputs({ KV_NAMESPACE_ID: KV_ID, GATEWAY_DOMAIN: value }),
    ).toThrow(
      expect.objectContaining({
        constructor: DeployConfigError,
        message: expect.stringContaining('GATEWAY_DOMAIN'),
      }),
    );
  });
});

describe('renderDeployConfig', () => {
  it('replaces the placeholder ID and changes nothing else', () => {
    const source = `{\n  // keep me\n  "id": "${KV_ID_PLACEHOLDER}",\n}\n`;
    expect(renderDeployConfig(source, KV_ID)).toBe(
      `{\n  // keep me\n  "id": "${KV_ID}",\n}\n`,
    );
  });

  it('refuses a config without the placeholder', () => {
    expect(() => renderDeployConfig('{ "id": "abc" }', KV_ID)).toThrow(
      DeployConfigError,
    );
  });

  it('refuses a config with the placeholder more than once', () => {
    const twice = `"${KV_ID_PLACEHOLDER}" "${KV_ID_PLACEHOLDER}"`;
    expect(() => renderDeployConfig(twice, KV_ID)).toThrow(DeployConfigError);
  });

  it('works on the committed wrangler.jsonc', () => {
    const rendered = renderDeployConfig(committedConfig, KV_ID);
    expect(rendered).toContain(`"id": "${KV_ID}"`);
    expect(rendered).not.toContain(KV_ID_PLACEHOLDER);
  });
});
