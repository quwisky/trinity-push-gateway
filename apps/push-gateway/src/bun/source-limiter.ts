import type { SourceLimiter } from '../ports';

type LimiterOptions = {
  readonly limit: number;
  readonly maxKeys: number;
  readonly now: () => number;
  readonly periodSeconds: number;
};

type Window = {
  count: number;
  readonly expiresAt: number;
};

export function createMemorySourceLimiter(
  options: LimiterOptions,
): SourceLimiter {
  const windows = new Map<string, Window>();
  const periodMs = options.periodSeconds * 1000;

  return {
    limit(key) {
      const now = options.now();
      for (const [source, window] of windows) {
        if (window.expiresAt <= now) {
          windows.delete(source);
        }
      }

      const existing = windows.get(key);
      if (existing !== undefined) {
        if (existing.count >= options.limit) {
          return Promise.resolve({
            retryAfterSeconds: Math.max(
              1,
              Math.ceil((existing.expiresAt - now) / 1000),
            ),
            success: false,
          });
        }
        existing.count += 1;
        return Promise.resolve({
          retryAfterSeconds: options.periodSeconds,
          success: true,
        });
      }

      if (windows.size >= options.maxKeys) {
        const earliestExpiry = Math.min(
          ...[...windows.values()].map(({ expiresAt }) => expiresAt),
        );
        return Promise.resolve({
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((earliestExpiry - now) / 1000),
          ),
          success: false,
        });
      }

      windows.set(key, { count: 1, expiresAt: now + periodMs });
      return Promise.resolve({
        retryAfterSeconds: options.periodSeconds,
        success: true,
      });
    },
  };
}
