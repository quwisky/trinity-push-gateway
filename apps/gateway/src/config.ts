import * as v from 'valibot';

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface AppEntry {
  kind: 'fcm';
}

export interface Config {
  apps: Readonly<Record<string, AppEntry>>;
  serviceAccount: ServiceAccount;
}

/** Thrown when the Worker's vars or secrets are missing or malformed. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const PEM_HEADER = '-----BEGIN PRIVATE KEY-----';

const AppsSchema = v.pipe(
  v.record(v.string(), v.object({ kind: v.literal('fcm') })),
  v.minEntries(1),
);

const ServiceAccountSchema = v.pipe(
  v.looseObject({
    project_id: v.pipe(v.string(), v.nonEmpty()),
    client_email: v.pipe(v.string(), v.nonEmpty()),
    private_key: v.pipe(
      v.string(),
      // Copy-pasted service-account JSON often carries literal `\n` escapes.
      v.transform((key) => key.replaceAll('\\n', '\n')),
      v.startsWith(PEM_HEADER),
    ),
  }),
  v.transform((sa): ServiceAccount => ({
    projectId: sa.project_id,
    clientEmail: sa.client_email,
    privateKey: sa.private_key,
  })),
);

/**
 * Describes where validation failed, from issue paths only. Valibot's own
 * messages can include the received value, which may be secret.
 */
function describeIssues(
  root: string,
  issues: [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]],
): string {
  const paths = new Set(
    issues.map((issue) =>
      [root, ...(issue.path ?? []).map((item) => String(item.key))].join('.'),
    ),
  );
  return `invalid ${[...paths].join(', ')}`;
}

function parseSecret(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    throw new ConfigError('FCM_SERVICE_ACCOUNT is not set');
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Not chained: the parser's message can quote part of the input.
    throw new ConfigError('FCM_SERVICE_ACCOUNT is not valid JSON');
  }
}

export function parseConfig(env: {
  APPS: unknown;
  FCM_SERVICE_ACCOUNT: unknown;
}): Config {
  const apps = v.safeParse(AppsSchema, env.APPS);
  if (!apps.success) {
    throw new ConfigError(describeIssues('APPS', apps.issues));
  }

  const sa = v.safeParse(
    ServiceAccountSchema,
    parseSecret(env.FCM_SERVICE_ACCOUNT),
  );
  if (!sa.success) {
    throw new ConfigError(describeIssues('FCM_SERVICE_ACCOUNT', sa.issues));
  }

  return { apps: apps.output, serviceAccount: sa.output };
}
