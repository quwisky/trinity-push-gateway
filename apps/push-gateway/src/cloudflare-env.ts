import type { ConfigurationEnvironment } from './config';

export type Env = ConfigurationEnvironment & {
  readonly TRINITY_PUSH_GATEWAY_DB: D1Database;
  readonly TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMITER: RateLimit;
};
