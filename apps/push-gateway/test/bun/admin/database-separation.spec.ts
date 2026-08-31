import { afterEach, describe, expect, it } from 'bun:test';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { assertAdministrationDatabaseSeparated } from '../../../src/bun/admin/database-separation';

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'trinity-admin-database-separation-'),
  );
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('administration database separation', () => {
  it.each(['-wal', '-shm'])(
    'rejects a missing delivery database%s target through its real parent',
    (suffix) => {
      const directory = temporaryDirectory();
      const realDirectory = path.join(directory, 'real');
      const aliasDirectory = path.join(directory, 'alias');
      mkdirSync(realDirectory);
      symlinkSync(realDirectory, aliasDirectory);
      const gatewayPath = path.join(realDirectory, 'gateway.sqlite');
      writeFileSync(gatewayPath, '');

      expect(() => {
        assertAdministrationDatabaseSeparated(
          gatewayPath,
          path.join(aliasDirectory, `gateway.sqlite${suffix}`),
        );
      }).toThrow('physically separate');
    },
  );

  it.each(['-wal', '-shm'])(
    'rejects a dangling administration symlink to a missing delivery database%s target',
    (suffix) => {
      const directory = temporaryDirectory();
      const gatewayPath = path.join(directory, 'gateway.sqlite');
      const adminPath = path.join(directory, 'admin.sqlite');
      writeFileSync(gatewayPath, '');
      symlinkSync(`${gatewayPath}${suffix}`, adminPath);

      expect(() => {
        assertAdministrationDatabaseSeparated(gatewayPath, adminPath);
      }).toThrow('physically separate');
    },
  );

  it.each(['-wal', '-shm'])(
    'rejects delivery storage that aliases an administration database%s target',
    (suffix) => {
      const directory = temporaryDirectory();
      const adminPath = path.join(directory, 'admin.sqlite');
      const gatewayPath = `${adminPath}${suffix}`;
      writeFileSync(gatewayPath, 'delivery');

      expect(() => {
        assertAdministrationDatabaseSeparated(gatewayPath, adminPath);
      }).toThrow('physically separate');
    },
  );

  it.each(['-wal', '-shm'])(
    'rejects an administration database%s symlink to delivery storage',
    (suffix) => {
      const directory = temporaryDirectory();
      const gatewayPath = path.join(directory, 'gateway.sqlite');
      const adminPath = path.join(directory, 'admin.sqlite');
      writeFileSync(gatewayPath, 'delivery');
      symlinkSync(gatewayPath, `${adminPath}${suffix}`);

      expect(() => {
        assertAdministrationDatabaseSeparated(gatewayPath, adminPath);
      }).toThrow('physically separate');
    },
  );

  it.each(['-wal', '-shm'])(
    'rejects a hardlink to an existing delivery database%s target',
    (suffix) => {
      const directory = temporaryDirectory();
      const gatewayPath = path.join(directory, 'gateway.sqlite');
      const sidecarPath = `${gatewayPath}${suffix}`;
      const adminPath = path.join(directory, 'admin.sqlite');
      writeFileSync(gatewayPath, '');
      writeFileSync(sidecarPath, 'sidecar');
      linkSync(sidecarPath, adminPath);

      expect(() => {
        assertAdministrationDatabaseSeparated(gatewayPath, adminPath);
      }).toThrow('physically separate');
    },
  );
});
