import {
  migrateAdministration,
  purgeAdministrationSessions,
} from './admin/runtime';
import { loadBunConfiguration } from './config';
import { readMigrations } from './migrations';
import { startBunGateway } from './server';
import { SqliteGatewayStore } from './sqlite-store';

function log(event: Readonly<Record<string, unknown>>): void {
  console.info(JSON.stringify(event));
}

const config = loadBunConfiguration(process.env);
const migrations = readMigrations(config.migrationsPath);
const command = process.argv[2] ?? 'serve';

if (command === 'serve') {
  await startBunGateway(config, migrations, {
    log,
    operationEntryPath: import.meta.path,
  });
} else if (command === 'migrate') {
  const store = SqliteGatewayStore.open(config.databasePath, migrations);
  store.close();
  if (config.administration.kind === 'enabled') {
    migrateAdministration(config.administration, config.databasePath);
  } else if (config.administration.kind === 'invalid') {
    throw new Error('Administration configuration is invalid.');
  }
  log({ event: 'migrations_applied' });
} else if (command === 'session-purge') {
  const revokedSessions = await purgeAdministrationSessions(
    config.administration,
    Math.floor(Date.now() / 1_000),
    config.databasePath,
  );
  log({ event: 'admin_sessions_purged', revokedSessions });
} else if (command === 'backup') {
  const targetPath = process.argv[3];
  if (targetPath === undefined) {
    throw new Error('Usage: gateway backup <new-snapshot-path>');
  }
  const store = SqliteGatewayStore.open(config.databasePath, migrations);
  try {
    store.backup(targetPath);
  } finally {
    store.close();
  }
  log({ event: 'backup_created' });
} else if (command === 'maintenance-cleanup') {
  const store = SqliteGatewayStore.open(config.databasePath, migrations);
  try {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    await store.cleanup(
      nowSeconds,
      new Date(nowSeconds * 1_000).toISOString().slice(0, 10),
    );
  } finally {
    store.close();
  }
} else if (command === 'maintenance-backup') {
  const targetPath = process.argv[3];
  if (targetPath === undefined) {
    throw new Error('Internal backup target is required.');
  }
  const store = SqliteGatewayStore.open(config.databasePath, migrations);
  try {
    store.backup(targetPath);
  } finally {
    store.close();
  }
} else {
  throw new Error(`Unknown gateway command: ${command}`);
}
