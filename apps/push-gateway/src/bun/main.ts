import { loadBunConfiguration } from './config';
import { readMigrations } from './migrations';
import { startBunGateway } from './server';
import { SqliteGatewayStore } from './sqlite-store';

function log(event: Readonly<Record<string, unknown>>): void {
  console.info(JSON.stringify(event));
}

const config = loadBunConfiguration(process.env);
const migrations = readMigrations(
  process.env.TRINITY_PUSH_GATEWAY_MIGRATIONS_PATH ?? '/app/migrations',
);
const command = process.argv[2] ?? 'serve';

if (command === 'serve') {
  await startBunGateway(config, migrations, { log });
} else if (command === 'migrate') {
  const store = SqliteGatewayStore.open(config.databasePath, migrations);
  store.close();
  log({ event: 'migrations_applied' });
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
} else {
  throw new Error(`Unknown gateway command: ${command}`);
}
