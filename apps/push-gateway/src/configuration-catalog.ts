import * as z from 'zod/mini';

type Environment = Readonly<Record<string, string | undefined>>;
type ReadSecretFile = (path: string) => string;

export type ConfigurationCatalogReference<SettingName extends string> =
  Readonly<{
    constraint?: string;
    defaultValue?: string;
    description: string;
    name: SettingName;
    required: boolean;
    runtimes: readonly ('bun' | 'cloudflare' | 'compose')[];
    secret: boolean;
  }>;

type CatalogSettingName =
  | 'TRINITY_PUSH_GATEWAY_ADMIN_ENABLED'
  | 'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET'
  | 'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE';

export type CatalogSecret = Readonly<{
  source: 'env' | 'file';
  value: string;
}>;

export type CatalogSafeAdministrationConfiguration = Readonly<{
  administrationEnabled: true;
  sessionSecret: Readonly<{
    configured: true;
    source: CatalogSecret['source'];
  }>;
}>;

type AdministrationCatalogState =
  | Readonly<{ kind: 'disabled' }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{
      configuration: Readonly<{
        administrationEnabled: true;
        sessionSecret: CatalogSecret;
      }>;
      kind: 'enabled';
      safe: CatalogSafeAdministrationConfiguration;
    }>;

type LoadOptions = Readonly<{
  readFile: ReadSecretFile;
}>;

const ADMINISTRATION_ENABLED_REFERENCE = Object.freeze({
  constraint:
    'Exact true or false; every other administration value is ignored while false.',
  defaultValue: 'false',
  description: 'Opt in to the isolated Bun administration surface.',
  name: 'TRINITY_PUSH_GATEWAY_ADMIN_ENABLED',
  required: false,
  runtimes: ['bun'],
  secret: false,
} as const);
const ADMINISTRATION_ENABLED_SCHEMA = z.enum(['true', 'false']);

const SESSION_SECRET = Object.freeze({
  direct: {
    constraint:
      'At least 32 UTF-8 bytes and required directly or by file when enabled; mutually exclusive with its file alternative.',
    description: 'Independent secret used to protect Operator Sessions.',
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET',
    required: false,
    runtimes: ['bun'],
    secret: true,
  },
  directSchema: z.string().check(z.minLength(1)),
  file: {
    constraint:
      'Required directly or by file when enabled; mutually exclusive with its direct alternative.',
    description: 'Operator Session secret file.',
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE',
    required: false,
    runtimes: ['bun'],
    secret: true,
  },
  fileSchema: z.string().check(z.minLength(1)),
  minimumBytes: 32,
} as const);

function reference(
  name: CatalogSettingName,
): ConfigurationCatalogReference<CatalogSettingName> {
  if (name === ADMINISTRATION_ENABLED_REFERENCE.name) {
    return ADMINISTRATION_ENABLED_REFERENCE;
  }
  return name === SESSION_SECRET.direct.name
    ? SESSION_SECRET.direct
    : SESSION_SECRET.file;
}

function sessionSecret(
  environment: Environment,
  readFile: ReadSecretFile,
): CatalogSecret | undefined {
  const direct = environment[SESSION_SECRET.direct.name];
  const file = environment[SESSION_SECRET.file.name];
  if (direct !== undefined && file !== undefined) {
    return undefined;
  }

  let source: CatalogSecret['source'];
  let value: string;
  if (direct !== undefined) {
    const parsed = SESSION_SECRET.directSchema.safeParse(direct);
    if (!parsed.success) {
      return undefined;
    }
    source = 'env';
    value = parsed.data;
  } else {
    const parsed = SESSION_SECRET.fileSchema.safeParse(file);
    if (!parsed.success) {
      return undefined;
    }
    source = 'file';
    value = readFile(parsed.data).trimEnd();
  }

  return new TextEncoder().encode(value).byteLength >=
    SESSION_SECRET.minimumBytes
    ? { source, value }
    : undefined;
}

function load(
  environment: Environment,
  options: LoadOptions,
): AdministrationCatalogState {
  const parsed = ADMINISTRATION_ENABLED_SCHEMA.safeParse(
    environment[ADMINISTRATION_ENABLED_REFERENCE.name] ??
      ADMINISTRATION_ENABLED_REFERENCE.defaultValue,
  );
  if (!parsed.success) {
    return { kind: 'invalid' };
  }
  if (parsed.data === 'false') {
    return { kind: 'disabled' };
  }

  try {
    const loadedSecret = sessionSecret(environment, options.readFile);
    return loadedSecret === undefined
      ? { kind: 'invalid' }
      : {
          configuration: {
            administrationEnabled: true,
            sessionSecret: loadedSecret,
          },
          kind: 'enabled',
          safe: {
            administrationEnabled: true,
            sessionSecret: {
              configured: true,
              source: loadedSecret.source,
            },
          },
        };
  } catch {
    return { kind: 'invalid' };
  }
}

export const ADMINISTRATION_CONFIGURATION_CATALOG = Object.freeze({
  load,
  reference,
});
