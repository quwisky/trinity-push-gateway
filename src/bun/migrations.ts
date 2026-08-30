import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { SqlMigration } from './sqlite-store';

export function readMigrations(directory: string): readonly SqlMigration[] {
  return readdirSync(directory)
    .filter((name) => /^\d+_.+\.sql$/u.test(name))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(path.join(directory, name), 'utf8'),
    }));
}
