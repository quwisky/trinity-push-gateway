import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type DocumentationOutput = Readonly<{
  bytes: number;
  files: number;
}>;

function walk(directory: string, relative = ''): DocumentationOutput {
  let bytes = 0;
  let files = 0;
  for (const name of readdirSync(path.join(directory, relative))) {
    const childRelative = path.join(relative, name);
    const child = path.join(directory, childRelative);
    const stats = lstatSync(child);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Documentation output contains a symbolic link: ${childRelative}`,
      );
    }
    if (stats.isDirectory()) {
      const nested = walk(directory, childRelative);
      bytes += nested.bytes;
      files += nested.files;
    } else if (stats.isFile()) {
      bytes += stats.size;
      files += 1;
    }
  }
  return { bytes, files };
}

export function validateDocumentationOutput(
  outputDirectory: string,
  maximumBytes = 10 * 1024 * 1024,
): DocumentationOutput {
  const absolute = path.resolve(outputDirectory);
  const requiredFiles = [
    path.join(absolute, 'index.html'),
    path.join(absolute, 'getting-started', 'index.html'),
  ];
  for (const required of requiredFiles) {
    if (!lstatSync(required).isFile()) {
      throw new Error(`Documentation output is missing ${required}.`);
    }
  }
  const unpublishedAgents = path.join(absolute, 'agents');
  try {
    lstatSync(unpublishedAgents);
    throw new Error(
      'Documentation output must not publish docs/agents content.',
    );
  } catch (error) {
    if (
      error instanceof Error &&
      !('code' in error && error.code === 'ENOENT')
    ) {
      throw error;
    }
  }
  const result = walk(absolute);
  if (result.bytes > maximumBytes) {
    throw new Error(
      `Documentation output exceeds its ${String(maximumBytes)} byte budget: ${String(result.bytes)} bytes.`,
    );
  }
  return result;
}

const invokedPath = process.argv.at(1);
if (
  invokedPath &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  const outputDirectory =
    process.argv.at(2) ??
    process.env.TRINITY_DOCS_OUT_DIR ??
    path.resolve(import.meta.dirname, '../../dist/docs/push-gateway-docs');
  const result = validateDocumentationOutput(outputDirectory);
  process.stdout.write(
    `Documentation output: ${String(result.files)} files, ${String(result.bytes)} bytes.\n`,
  );
}
