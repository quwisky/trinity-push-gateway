export async function reserveDailyAttempts(
  database: D1Database,
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
  const reserved = await database
    .prepare(
      `INSERT INTO daily_budgets (utc_date, attempts)
       VALUES (?1, ?2)
       ON CONFLICT (utc_date) DO UPDATE SET
         attempts = daily_budgets.attempts + excluded.attempts
       WHERE daily_budgets.attempts + excluded.attempts <= ?3
       RETURNING attempts`,
    )
    .bind(utcDate, requestedAttempts, maximumAttempts)
    .first<{ readonly attempts: number }>();
  return reserved !== null;
}
