import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { operatorSessionOpenApiComponents } from '../src/admin-contract/operator-session-openapi';

const openApiPath = fileURLToPath(
  new URL('../openapi/admin-v1.yaml', import.meta.url),
);
const START_MARKER = '    # BEGIN GENERATED OPERATOR SESSION CONTRACT';
const END_MARKER = '    # END GENERATED OPERATOR SESSION CONTRACT';
const check = process.argv.slice(2).includes('--check');

function scalar(value: unknown): string {
  return typeof value === 'string'
    ? `'${value.replaceAll("'", "''")}'`
    : JSON.stringify(value);
}

function yaml(value: unknown, indentation: number): string {
  const indent = ' '.repeat(indentation);
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry !== null && typeof entry === 'object') {
          return `${indent}-\n${yaml(entry, indentation + 2)}`;
        }
        return `${indent}- ${scalar(entry)}`;
      })
      .join('\n');
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) => {
        if (entry !== null && typeof entry === 'object') {
          return `${indent}${key}:\n${yaml(entry, indentation + 2)}`;
        }
        return `${indent}${key}: ${scalar(entry)}`;
      })
      .join('\n');
  }
  return `${indent}${scalar(value)}`;
}

function generatedBlock(): string {
  return [
    START_MARKER,
    yaml(operatorSessionOpenApiComponents(), 4),
    END_MARKER,
  ].join('\n');
}

function generatedOpenApi(source: string): string {
  const start = source.indexOf(START_MARKER);
  const end = source.indexOf(END_MARKER);
  if (start < 0 || end < start) {
    throw new Error(
      'Operator Session contract generation markers are missing.',
    );
  }
  const suffix = end + END_MARKER.length;
  return `${source.slice(0, start)}${generatedBlock()}${source.slice(suffix)}`;
}

const current = await readFile(openApiPath, 'utf8');
const generated = generatedOpenApi(current);

if (check) {
  if (current !== generated) {
    throw new Error(
      'Generated Operator Session contract has drifted; run the generate-admin-contract target.',
    );
  }
  console.info('Generated Operator Session contract is current.');
} else {
  if (current !== generated) {
    await writeFile(openApiPath, generated);
  }
  console.info('Generated Operator Session OpenAPI component.');
}
