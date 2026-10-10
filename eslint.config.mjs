import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist', '**/.wrangler', '**/worker-configuration.d.ts']),
  tseslint.configs.recommended,
]);
