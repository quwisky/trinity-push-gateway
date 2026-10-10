/**
 * Turns the committed wrangler.jsonc into the config a real deploy uses.
 *
 * The deployment's KV namespace ID and Custom Domain come from the environment (GitHub
 * repository variables in CI) rather than the repository, so forks deploy without editing
 * files. Wrangler has a `--domain` flag but no flag for a KV namespace ID, so the ID is
 * substituted for the placeholder in a generated copy of the config.
 *
 * Pure and dependency-free: the Vitest suite imports it, and so does scripts/deploy.mjs
 * under plain Node (which strips the types).
 */

/** The KV namespace ID committed in wrangler.jsonc; local dev and tests never need a real one. */
export const KV_ID_PLACEHOLDER = '00000000000000000000000000000000';

const KV_ID = /^[0-9a-f]{32}$/;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export interface DeployInputs {
  readonly kvNamespaceId: string;
  readonly domain: string;
}

export class DeployConfigError extends Error {}

/** Reads `KV_NAMESPACE_ID` and `GATEWAY_DOMAIN`, trimmed and lower-cased, or explains what is wrong. */
export function readDeployInputs(
  env: Readonly<Record<string, string | undefined>>,
): DeployInputs {
  const kvNamespaceId = (env['KV_NAMESPACE_ID'] ?? '').trim().toLowerCase();
  if (!KV_ID.test(kvNamespaceId) || kvNamespaceId === KV_ID_PLACEHOLDER) {
    throw new DeployConfigError(
      'KV_NAMESPACE_ID must be the 32-character hex ID of your TOKENS namespace (wrangler kv namespace create TOKENS).',
    );
  }

  const domain = (env['GATEWAY_DOMAIN'] ?? '').trim().toLowerCase();
  const labels = domain.split('.');
  if (
    domain.length > 253 ||
    labels.length < 2 ||
    !labels.every((label) => LABEL.test(label))
  ) {
    throw new DeployConfigError(
      'GATEWAY_DOMAIN must be a bare hostname such as push.example.org, with no scheme or path.',
    );
  }

  return { kvNamespaceId, domain };
}

/** Swaps the placeholder KV namespace ID for the real one; refuses unless it appears exactly once. */
export function renderDeployConfig(
  source: string,
  kvNamespaceId: string,
): string {
  const quoted = `"${KV_ID_PLACEHOLDER}"`;
  const count = source.split(quoted).length - 1;
  if (count !== 1) {
    throw new DeployConfigError(
      `wrangler.jsonc must contain the placeholder KV namespace ID ${quoted} exactly once; found ${count}.`,
    );
  }
  return source.replace(quoted, `"${kvNamespaceId}"`);
}
