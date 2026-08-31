import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { gatewaySchema, type GatewaySchema } from './schema';

export type GatewayD1Database = DrizzleD1Database<GatewaySchema>;

export function createGatewayD1Database(
  database: D1Database,
): GatewayD1Database {
  return drizzle(database, { schema: gatewaySchema });
}
