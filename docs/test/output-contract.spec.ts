import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateDocumentationOutput } from '../scripts/output-contract';

const directories: string[] = [];

function outputDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'trinity-docs-output-'));
  directories.push(directory);
  writeFileSync(path.join(directory, 'index.html'), '<html lang="en"></html>');
  mkdirSync(path.join(directory, 'getting-started'));
  writeFileSync(
    path.join(directory, 'getting-started', 'index.html'),
    '<html lang="en"></html>',
  );
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('built documentation contract', () => {
  it('accepts a complete static site within its byte budget', () => {
    expect(validateDocumentationOutput(outputDirectory(), 1024)).toEqual({
      bytes: 46,
      files: 2,
    });
  });

  it('rejects unpublished agent content and oversized output', () => {
    const directory = outputDirectory();
    mkdirSync(path.join(directory, 'agents'));
    writeFileSync(path.join(directory, 'agents', 'domain.html'), 'internal');

    expect(() => validateDocumentationOutput(directory, 1024)).toThrow(
      'agents',
    );
    rmSync(path.join(directory, 'agents'), { recursive: true });
    expect(() => validateDocumentationOutput(directory, 10)).toThrow(
      'byte budget',
    );
  });
});
