import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../src/hash';
import { allowPushkey } from '../src/ratelimit';

describe('allowPushkey', () => {
  it('allows when there is no limiter', async () => {
    expect(await allowPushkey(undefined, 'k')).toBe(true);
  });

  it('denies when the limiter refuses, keyed by the pushkey hash', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    expect(await allowPushkey({ limit }, 'k')).toBe(false);
    expect(limit).toHaveBeenCalledWith({ key: await sha256Hex('k') });
  });

  it('allows when the limiter accepts', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    expect(await allowPushkey({ limit }, 'k')).toBe(true);
  });

  it('fails open when the limiter throws', async () => {
    const limit = vi.fn().mockRejectedValue(new Error('boom'));
    expect(await allowPushkey({ limit }, 'k')).toBe(true);
  });
});
