export default {
  'apps/push-gateway/**/*.{js,cjs,mjs,ts,cts,mts}': () =>
    'pnpm nx run push-gateway:lint --fix --skip-nx-cache',
  'docs/**/*.{js,cjs,mjs,ts,cts,mts,vue}': () =>
    'pnpm nx run push-gateway-docs:lint --fix --skip-nx-cache',
  '*.{js,cjs,mjs,ts,cts,mts}': 'prettier --write',
  '*.{json,json5,jsonc,md,mdx,yaml,yml,css,scss,html}': 'prettier --write',
};
