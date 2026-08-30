import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { SqlMigration } from '../../src/bun/sqlite-store';

export const initialMigration: SqlMigration = {
  name: '0001_initial.sql',
  sql: readFileSync(
    path.join(import.meta.dir, '../../migrations/0001_initial.sql'),
    'utf8',
  ),
};

export const canonicalMigrations: readonly SqlMigration[] = [initialMigration];
