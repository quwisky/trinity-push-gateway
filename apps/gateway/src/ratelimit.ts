import { sha256Hex } from './hash';

/**
 * Whether a pushkey may be delivered to now. Fails open: with no limiter bound,
 * or if the limiter throws, the device is allowed. The key is the pushkey's
 * hash, so the raw token never reaches the limiter.
 */
export async function allowPushkey(
  limiter: RateLimit | undefined,
  pushkey: string,
): Promise<boolean> {
  if (limiter === undefined) return true;
  try {
    const { success } = await limiter.limit({ key: await sha256Hex(pushkey) });
    return success;
  } catch {
    return true;
  }
}
