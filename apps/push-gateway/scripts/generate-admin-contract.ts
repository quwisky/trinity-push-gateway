import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { configurationOpenApiComponents } from '../src/admin-contract/configuration-openapi';
import { operatorSessionOpenApiComponents } from '../src/admin-contract/operator-session-openapi';

const openApiPath = fileURLToPath(
  new URL('../openapi/admin-v1.yaml', import.meta.url),
);
type GeneratedContractBlock = Readonly<{
  components: Readonly<Record<string, unknown>>;
  endMarker: string;
  name: string;
  startMarker: string;
}>;

const GENERATED_CONTRACT_BLOCKS: readonly GeneratedContractBlock[] = [
  {
    components: operatorSessionOpenApiComponents(),
    endMarker: '    # END GENERATED OPERATOR SESSION CONTRACT',
    name: 'Operator Session',
    startMarker: '    # BEGIN GENERATED OPERATOR SESSION CONTRACT',
  },
  {
    components: configurationOpenApiComponents(),
    endMarker: '    # END GENERATED CONFIGURATION CONTRACT',
    name: 'configuration',
    startMarker: '    # BEGIN GENERATED CONFIGURATION CONTRACT',
  },
];
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

function generatedBlock(block: GeneratedContractBlock): string {
  return [block.startMarker, yaml(block.components, 4), block.endMarker].join(
    '\n',
  );
}

function replaceGeneratedBlock(
  source: string,
  block: GeneratedContractBlock,
): string {
  const start = source.indexOf(block.startMarker);
  const end = source.indexOf(block.endMarker);
  if (start < 0 || end < start) {
    throw new Error(`${block.name} contract generation markers are missing.`);
  }
  const suffix = end + block.endMarker.length;
  return `${source.slice(0, start)}${generatedBlock(block)}${source.slice(suffix)}`;
}

function generatedOpenApi(source: string): string {
  return GENERATED_CONTRACT_BLOCKS.reduce(replaceGeneratedBlock, source);
}

const current = await readFile(openApiPath, 'utf8');
const generated = generatedOpenApi(current);

if (check) {
  if (current !== generated) {
    throw new Error(
      'Generated administration contracts have drifted; run the generate-admin-contract target.',
    );
  }
  console.info('Generated administration contracts are current.');
} else {
  if (current !== generated) {
    await writeFile(openApiPath, generated);
  }
  console.info('Generated administration OpenAPI components.');
}
