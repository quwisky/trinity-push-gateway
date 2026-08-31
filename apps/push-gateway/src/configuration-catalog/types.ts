export type ConfigurationRuntime = 'bun' | 'cloudflare' | 'compose';

export type ConfigurationCatalogReference<SettingName extends string> =
  Readonly<{
    constraint?: string;
    defaultValue?: string;
    description: string;
    name: SettingName;
    required: boolean;
    runtimes: readonly ConfigurationRuntime[];
    secret: boolean;
  }>;

export type ConfigurationEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type CatalogSecret = Readonly<{
  source: 'env' | 'file';
  value: string;
}>;

export type CatalogSecretResolution =
  | Readonly<{ kind: 'resolved'; secret: CatalogSecret }>
  | Readonly<{
      kind: 'invalid';
      reason: 'conflicting-sources' | 'empty-file-name' | 'missing';
    }>
  | Readonly<{
      kind: 'invalid';
      reason: 'value-too-short';
      source: CatalogSecret['source'];
    }>;

export function resolveCatalogSecret(
  environment: ConfigurationEnvironment,
  name: string,
  readFile: (path: string) => string,
  minimumBytes = 1,
): CatalogSecretResolution {
  const direct = environment[name];
  const fileName = `${name}_FILE`;
  const file = environment[fileName];
  if (direct !== undefined && file !== undefined) {
    return { kind: 'invalid', reason: 'conflicting-sources' };
  }

  let source: CatalogSecret['source'];
  let value: string;
  if (direct !== undefined) {
    source = 'env';
    value = direct;
  } else if (file === undefined) {
    return { kind: 'invalid', reason: 'missing' };
  } else if (file.length === 0) {
    return { kind: 'invalid', reason: 'empty-file-name' };
  } else {
    source = 'file';
    value = readFile(file).trimEnd();
  }

  return new TextEncoder().encode(value).byteLength >= minimumBytes
    ? { kind: 'resolved', secret: { source, value } }
    : { kind: 'invalid', reason: 'value-too-short', source };
}

type EntryWithDefault<
  Entries extends readonly ConfigurationCatalogReference<string>[],
> = Extract<Entries[number], Readonly<{ defaultValue: string }>>;

export type CatalogDefaults<
  Entries extends readonly ConfigurationCatalogReference<string>[],
> = Readonly<{
  [Entry in EntryWithDefault<Entries> as Entry['name']]: Entry['defaultValue'];
}>;

export function catalogDefaults<
  const Entries extends readonly ConfigurationCatalogReference<string>[],
>(entries: Entries): CatalogDefaults<Entries> {
  return Object.freeze(
    Object.fromEntries(
      entries.flatMap((entry) =>
        entry.defaultValue === undefined
          ? []
          : [[entry.name, entry.defaultValue] as const],
      ),
    ),
  ) as CatalogDefaults<Entries>;
}
