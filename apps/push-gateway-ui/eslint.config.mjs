import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  {
    ignores: [
      'orval.config.ts',
      'scripts/**/*.mjs',
      'src/app/api/generated/**/*.ts',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        // `projectService` conflicts with a `parserOptions.project` set by any config
        // merged into this one. Remove this once you know none of them set it.
        project: null,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      // Decorated Angular components and directives may intentionally be
      // behavior-free markers whose meaning lives in their metadata.
      '@typescript-eslint/no-extraneous-class': 'off',
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'tpg',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'tpg',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['src/app/ui/helm/**/*.ts'],
    rules: {
      // These app-owned selectors preserve Spartan Helm's public template API.
      '@angular-eslint/component-selector': 'off',
      '@angular-eslint/directive-selector': 'off',
      '@angular-eslint/no-input-rename': 'off',
    },
  },
  {
    files: ['src/app/features/operations/form/spartan-form.types.ts'],
    rules: {
      // TypeScript module augmentation requires an interface declaration.
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
  {
    files: ['**/*.html'],
    // Root rules are type-aware TypeScript rules; Angular templates use their
    // own parser and the Angular template rule set above.
    rules: tseslint.configs.disableTypeChecked.rules,
  },
];
