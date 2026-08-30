import type { ConfigurationEnvironment } from './env';

export type Env = ConfigurationEnvironment & {
  readonly DB: D1Database;
  readonly SOURCE_RATE_LIMITER: RateLimit;
};
