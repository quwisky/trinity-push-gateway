import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

const DELIVERY_OUTCOMES = ['pending', 'delivered', 'rejected'] as const;

export const deliveryRecords = sqliteTable(
  'delivery_records',
  {
    fingerprint: text('fingerprint').primaryKey(),
    outcome: text('outcome', { enum: DELIVERY_OUTCOMES }).notNull(),
    leaseExpiresAt: integer('lease_expires_at'),
    expiresAt: integer('expires_at').notNull(),
    reasonCategory: text('reason_category'),
  },
  (table) => [
    check(
      'delivery_records_outcome_check',
      sql`${table.outcome} IN ('pending', 'delivered', 'rejected')`,
    ),
    index('delivery_records_expiry_idx').on(table.expiresAt),
  ],
);

export const dailyBudgets = sqliteTable(
  'daily_budgets',
  {
    utcDate: text('utc_date').primaryKey(),
    attempts: integer('attempts').notNull(),
  },
  (table) => [
    check('daily_budgets_attempts_check', sql`${table.attempts} >= 0`),
  ],
);

export const gatewaySchema = { dailyBudgets, deliveryRecords };
export type GatewaySchema = typeof gatewaySchema;

export const BUDGET_COLUMNS = ['utc_date', 'attempts'] as const;
export const DELIVERY_COLUMNS = [
  'fingerprint',
  'outcome',
  'lease_expires_at',
  'expires_at',
  'reason_category',
] as const;
export const DELIVERY_EXPIRY_INDEX = 'delivery_records_expiry_idx';
export const HEALTH_CHECK_DATE = '0000-health-check';
