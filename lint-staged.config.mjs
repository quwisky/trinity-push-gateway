export default {
  '*.{js,cjs,mjs,ts,cts,mts}': [
    'eslint --fix --no-warn-ignored',
    'prettier --write',
  ],
  '*.{json,json5,jsonc,md,mdx,yaml,yml,css,scss,html}': 'prettier --write',
};
