import { lstatSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

type DatabaseTarget = Readonly<{
  canonicalPath: string;
  device?: bigint;
  inode?: bigint;
}>;

function isMissingPath(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function existingTarget(databasePath: string): DatabaseTarget {
  const canonicalPath = realpathSync.native(databasePath);
  const statistics = statSync(canonicalPath, { bigint: true });
  return {
    canonicalPath,
    device: statistics.dev,
    inode: statistics.ino,
  };
}

function targetAllowingMissing(
  databasePath: string,
  visited = new Set<string>(),
): DatabaseTarget {
  try {
    return existingTarget(databasePath);
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
  }

  const canonicalPath = path.join(
    realpathSync.native(path.dirname(databasePath)),
    path.basename(databasePath),
  );
  if (visited.has(canonicalPath)) {
    throw new Error('Administration storage path contains a symlink cycle.');
  }
  visited.add(canonicalPath);
  try {
    const statistics = lstatSync(canonicalPath, { bigint: true });
    if (!statistics.isSymbolicLink()) {
      return {
        canonicalPath,
        device: statistics.dev,
        inode: statistics.ino,
      };
    }
    const linkTarget = readlinkSync(canonicalPath);
    return targetAllowingMissing(
      path.resolve(path.dirname(canonicalPath), linkTarget),
      visited,
    );
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
    return { canonicalPath };
  }
}

function sameTarget(left: DatabaseTarget, right: DatabaseTarget): boolean {
  return (
    left.canonicalPath === right.canonicalPath ||
    (left.device !== undefined &&
      left.inode !== undefined &&
      left.device === right.device &&
      left.inode === right.inode)
  );
}

export function assertAdministrationDatabaseSeparated(
  gatewayDatabasePath: string,
  administrationDatabasePath: string,
): void {
  const databaseTargets = (databasePath: string): readonly DatabaseTarget[] => {
    const mainTarget = targetAllowingMissing(databasePath);
    return [
      mainTarget,
      ...['-wal', '-shm'].flatMap((suffix) => [
        targetAllowingMissing(`${databasePath}${suffix}`),
        targetAllowingMissing(`${mainTarget.canonicalPath}${suffix}`),
      ]),
    ];
  };
  const gatewayTargets = databaseTargets(gatewayDatabasePath);
  const administrationTargets = databaseTargets(administrationDatabasePath);
  if (
    gatewayTargets.some((gatewayTarget) =>
      administrationTargets.some((administrationTarget) =>
        sameTarget(gatewayTarget, administrationTarget),
      ),
    )
  ) {
    throw new Error(
      'Administration storage must be physically separate from delivery storage.',
    );
  }
}
