import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, MAX_DEVICES, parseNotify } from '../src/notify/parse';

const device = { app_id: 'a', pushkey: 'k', data: { trinity_user_id: '@u:x' } };

function body(notification: unknown): string {
  return JSON.stringify({ notification });
}

function bytes(raw: string): number {
  return new TextEncoder().encode(raw).length;
}

/** A body of exactly `size` bytes, padded with 2-byte characters. */
function bodyOfSize(size: number): string {
  const make = (pad: string) =>
    body({ devices: [{ app_id: 'a', pushkey: 'k' }], pad });
  const base = bytes(make(''));
  const pad =
    'é'.repeat(Math.floor((size - base) / 2)) + 'a'.repeat((size - base) % 2);
  const raw = make(pad);
  expect(bytes(raw)).toBe(size);
  // Proves the test distinguishes bytes from UTF-16 length.
  expect(raw.length).toBeLessThan(size);
  return raw;
}

describe('parseNotify', () => {
  it('parses the event_id_only shape', () => {
    const result = parseNotify(
      body({
        event_id: '$e',
        room_id: '!r:x',
        prio: 'high',
        counts: { unread: 2 },
        devices: [device],
      }),
    );
    expect(result).toEqual({
      ok: true,
      notification: {
        event_id: '$e',
        room_id: '!r:x',
        prio: 'high',
        counts: { unread: 2 },
        devices: [device],
      },
    });
  });

  it('ignores unknown fields', () => {
    const result = parseNotify(
      JSON.stringify({
        notification: {
          type: 'm.room.message',
          sender: '@s:x',
          devices: [{ ...device, tweaks: { sound: 'default' } }],
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('defaults missing device data to {}', () => {
    const result = parseNotify(
      body({ devices: [{ app_id: 'a', pushkey: 'k' }] }),
    );
    expect(result).toMatchObject({
      ok: true,
      notification: { devices: [{ data: {} }] },
    });
  });

  it.each([['x'], [[1]], [null], [5]])(
    'tolerates non-object device data (%j)',
    (data) => {
      const result = parseNotify(
        body({ devices: [{ app_id: 'a', pushkey: 'k', data }] }),
      );
      expect(result).toMatchObject({
        ok: true,
        notification: { devices: [{ data: {} }] },
      });
    },
  );

  it('keeps counts.unread of 0', () => {
    const result = parseNotify(body({ counts: { unread: 0 }, devices: [] }));
    expect(result).toMatchObject({
      ok: true,
      notification: { counts: { unread: 0 } },
    });
  });

  it('keeps counts.unread of Number.MAX_SAFE_INTEGER', () => {
    const result = parseNotify(
      body({ counts: { unread: Number.MAX_SAFE_INTEGER }, devices: [] }),
    );
    expect(result).toMatchObject({
      ok: true,
      notification: { counts: { unread: Number.MAX_SAFE_INTEGER } },
    });
  });

  it.each([
    [{ unread: -1 }],
    [{ unread: 1.5 }],
    [{ unread: '2' }],
    [{ missed_calls: -1 }],
    [{ unread: 1e21 }],
    [{ missed_calls: 9007199254740992 }],
  ])('rejects invalid counts %j', (counts) => {
    expect(parseNotify(body({ counts, devices: [] }))).toMatchObject({
      ok: false,
      status: 400,
      errcode: 'M_BAD_JSON',
    });
  });

  it('rejects invalid JSON', () => {
    expect(parseNotify('{not json')).toMatchObject({
      ok: false,
      status: 400,
      errcode: 'M_BAD_JSON',
    });
  });

  it.each([
    ['a non-object body', '[]'],
    ['a missing notification', '{}'],
    ['missing devices', body({})],
    ['non-array devices', body({ devices: 'x' })],
    ['a device without pushkey', body({ devices: [{ app_id: 'a' }] })],
    ['a device without app_id', body({ devices: [{ pushkey: 'k' }] })],
  ])('rejects %s', (_name, raw) => {
    expect(parseNotify(raw)).toMatchObject({
      ok: false,
      status: 400,
      errcode: 'M_BAD_JSON',
    });
  });

  it('accepts 10 devices, rejects 11', () => {
    const devices = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ app_id: 'a', pushkey: `k${i}` }));
    expect(MAX_DEVICES).toBe(10);
    expect(parseNotify(body({ devices: devices(10) })).ok).toBe(true);
    expect(parseNotify(body({ devices: devices(11) }))).toMatchObject({
      ok: false,
      status: 400,
      errcode: 'M_BAD_JSON',
    });
  });

  it('accepts exactly 65536 bytes, rejects 65537', () => {
    expect(MAX_BODY_BYTES).toBe(65536);
    expect(parseNotify(bodyOfSize(65536)).ok).toBe(true);
    expect(parseNotify(bodyOfSize(65537))).toMatchObject({
      ok: false,
      status: 413,
      errcode: 'M_TOO_LARGE',
      error: 'Request body too large',
    });
  });

  it('accepts zero devices', () => {
    expect(parseNotify(body({ devices: [] }))).toEqual({
      ok: true,
      notification: { devices: [] },
    });
  });

  it('never echoes request values in error messages', () => {
    const secret = 'SECRET-PUSHKEY';
    const results = [
      parseNotify(body({ devices: [{ app_id: 'a', pushkey: 5, secret }] })),
      parseNotify(body({ room_id: secret, devices: 'x' })),
      parseNotify(body({ counts: { unread: secret }, devices: [] })),
      parseNotify(`{"notification": "${secret}`),
    ];
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain(secret);
    }
  });
});
