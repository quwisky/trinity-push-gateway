import { sql } from 'drizzle-orm';

import type { GatewayD1Database } from './d1-database';
import { dailyBudgets } from './schema';

export async function reserveDailyAttempts(
  database: GatewayD1Database,
  utcDate: string,
  requestedAttempts: number,
  maximumAttempts: number,
): Promise<boolean> {
  if (requestedAttempts === 0) {
    return true;
  }
  if (requestedAttempts > maximumAttempts) {
    return false;
  }
  const [reserved] = await database
    .insert(dailyBudgets)
    .values({ attempts: requestedAttempts, utcDate })
    .onConflictDoUpdate({
      set: {
        attempts: sql`${dailyBudgets.attempts} + ${requestedAttempts}`,
      },
      setWhere: sql`${dailyBudgets.attempts} + ${requestedAttempts} <= ${maximumAttempts}`,
      target: dailyBudgets.utcDate,
    })
    .returning({ attempts: dailyBudgets.attempts })
    .all();
  return reserved !== undefined;
}
