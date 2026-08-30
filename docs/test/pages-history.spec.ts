import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const script = new URL('../scripts/assemble-pages.sh', import.meta.url)
  .pathname;

function fixture(): Readonly<{
  history: string;
  latest: string;
  next: string;
  version: string;
}> {
  const directory = mkdtempSync(path.join(tmpdir(), 'trinity-pages-'));
  directories.push(directory);
  const paths = Object.fromEntries(
    ['history', 'latest', 'next', 'version'].map((name) => {
      const value = path.join(directory, name);
      mkdirSync(value);
      writeFileSync(path.join(value, 'index.html'), `<h1>${name}</h1>`);
      return [name, value];
    }),
  );
  return paths as {
    history: string;
    latest: string;
    next: string;
    version: string;
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Pages history assembly', () => {
  it('updates next and adds one immutable release with a local manifest', () => {
    const paths = fixture();
    const first = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRINITY_PAGES_HISTORY_DIR: paths.history,
        TRINITY_PAGES_NEXT_DIR: paths.next,
      },
    });
    expect(first.stderr).toBe('');
    expect(first.status).toBe(0);
    expect(
      readFileSync(path.join(paths.history, 'index.html'), 'utf8'),
    ).toContain('/trinity-push-gateway/next/');

    const release = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRINITY_PAGES_HISTORY_DIR: paths.history,
        TRINITY_PAGES_LATEST_DIR: paths.latest,
        TRINITY_PAGES_NEXT_DIR: paths.next,
        TRINITY_PAGES_RELEASE_DIR: paths.version,
        TRINITY_PAGES_RELEASE_TAG: 'v1.2.3',
      },
    });
    expect(release.stderr).toBe('');
    expect(release.status).toBe(0);
    expect(
      JSON.parse(
        readFileSync(path.join(paths.history, 'versions.json'), 'utf8'),
      ),
    ).toEqual({ latest: 'v1.2.3', versions: ['v1.2.3'] });
    expect(
      readFileSync(path.join(paths.history, 'index.html'), 'utf8'),
    ).toContain('/trinity-push-gateway/latest/');

    const retry = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRINITY_PAGES_HISTORY_DIR: paths.history,
        TRINITY_PAGES_LATEST_DIR: paths.latest,
        TRINITY_PAGES_NEXT_DIR: paths.next,
        TRINITY_PAGES_RELEASE_DIR: paths.version,
        TRINITY_PAGES_RELEASE_TAG: 'v1.2.3',
      },
    });
    expect(retry.stderr).toBe('');
    expect(retry.status).toBe(0);

    writeFileSync(path.join(paths.version, 'index.html'), '<h1>changed</h1>');
    const collision = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRINITY_PAGES_HISTORY_DIR: paths.history,
        TRINITY_PAGES_LATEST_DIR: paths.latest,
        TRINITY_PAGES_NEXT_DIR: paths.next,
        TRINITY_PAGES_RELEASE_DIR: paths.version,
        TRINITY_PAGES_RELEASE_TAG: 'v1.2.3',
      },
    });
    expect(collision.status).not.toBe(0);
    expect(collision.stderr).toContain('different output');
  });
});
