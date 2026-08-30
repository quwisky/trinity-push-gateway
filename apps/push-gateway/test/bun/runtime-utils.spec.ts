import { describe, expect, it } from 'bun:test';

import { clientAddress } from '../../src/bun/client-address';
import { createMemorySourceLimiter } from '../../src/bun/source-limiter';

describe('Bun source limiter', () => {
  it('bounds requests and source-key cardinality without evicting active keys', async () => {
    let now = 0;
    const limiter = createMemorySourceLimiter({
      limit: 2,
      maxKeys: 2,
      now: () => now,
      periodSeconds: 10,
    });

    expect((await limiter.limit('source-a')).success).toBe(true);
    expect((await limiter.limit('source-a')).success).toBe(true);
    expect(await limiter.limit('source-a')).toEqual({
      retryAfterSeconds: 10,
      success: false,
    });
    expect((await limiter.limit('source-b')).success).toBe(true);
    expect((await limiter.limit('source-c')).success).toBe(false);

    now = 10_001;
    expect((await limiter.limit('source-c')).success).toBe(true);
  });
});

describe('trusted proxy address resolution', () => {
  it('uses the direct peer unless that peer is explicitly trusted', () => {
    expect(
      clientAddress({
        clientIpHeader: 'x-forwarded-for',
        directAddress: '198.51.100.5',
        headers: new Headers({ 'x-forwarded-for': '192.0.2.8' }),
        trustedProxyCidrs: ['10.0.0.0/8'],
      }),
    ).toBe('198.51.100.5');
  });

  it('walks an X-Forwarded-For chain from trusted proxies toward the client', () => {
    expect(
      clientAddress({
        clientIpHeader: 'x-forwarded-for',
        directAddress: '10.0.0.2',
        headers: new Headers({
          'x-forwarded-for': '203.0.113.9, 10.0.0.3',
        }),
        trustedProxyCidrs: ['10.0.0.0/8'],
      }),
    ).toBe('203.0.113.9');
  });

  it('accepts one Cloudflare address only from a trusted peer', () => {
    expect(
      clientAddress({
        clientIpHeader: 'cf-connecting-ip',
        directAddress: '172.20.0.4',
        headers: new Headers({ 'cf-connecting-ip': '2001:db8::7' }),
        trustedProxyCidrs: ['172.20.0.0/16'],
      }),
    ).toBe('2001:db8::7');
  });

  it('fails malformed or entirely trusted chains into one shared key', () => {
    expect(
      clientAddress({
        clientIpHeader: 'x-forwarded-for',
        directAddress: '10.0.0.2',
        headers: new Headers({ 'x-forwarded-for': '10.0.0.3' }),
        trustedProxyCidrs: ['10.0.0.0/8'],
      }),
    ).toBe('unknown-source');
    expect(
      clientAddress({
        clientIpHeader: 'cf-connecting-ip',
        directAddress: '10.0.0.2',
        headers: new Headers({ 'cf-connecting-ip': 'not-an-address' }),
        trustedProxyCidrs: ['10.0.0.0/8'],
      }),
    ).toBe('unknown-source');
  });
});
