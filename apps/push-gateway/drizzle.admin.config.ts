import type { Config } from 'drizzle-kit';

export default {
  breakpoints: false,
  casing: 'snake_case',
  dialect: 'sqlite',
  migrations: { prefix: 'index' },
  out:
    process.env.TRINITY_DRIZZLE_ADMIN_MIGRATIONS_OUT ??
    './apps/push-gateway/admin-migrations',
  schema: './apps/push-gateway/src/bun/admin/schema.ts',
} satisfies Config;
