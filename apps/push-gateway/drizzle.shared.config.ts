import type { Config } from 'drizzle-kit';

export const gatewayDrizzleConfig = {
  breakpoints: false,
  casing: 'snake_case',
  dialect: 'sqlite',
  migrations: { prefix: 'index' },
  out:
    process.env.TRINITY_DRIZZLE_MIGRATIONS_OUT ??
    './apps/push-gateway/migrations',
  schema: './apps/push-gateway/src/schema.ts',
} satisfies Config;
