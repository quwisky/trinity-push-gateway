import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/hash';
import { buildFcmMessage } from '../src/payload';
import type { Device, Notification } from '../src/notify/parse';

const dev: Device = {
  app_id: 'a',
  pushkey: 'k',
  data: { trinity_user_id: '@u:x' },
};

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    event_id: '$e',
    room_id: '!r:x',
    prio: 'high',
    counts: { unread: 3, missed_calls: 1 },
    devices: [dev],
    ...overrides,
  };
}

function withoutKeys(n: Notification, ...keys: (keyof Notification)[]) {
  const copy = { ...n };
  for (const key of keys) delete copy[key];
  return copy;
}

async function build(n: Notification, d: Device = dev) {
  const message = await buildFcmMessage(n, d);
  expect(message).not.toBeNull();
  return message!;
}

describe('sha256Hex', () => {
  it('returns lowercase hex of 64 chars', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('buildFcmMessage', () => {
  it('builds the fallback mode message', async () => {
    const m = await build(notification());
    expect(m.token).toBe('k');
    expect(m.data).toEqual({
      event_id: '$e',
      room_id: '!r:x',
      trinity_user_id: '@u:x',
      unread: '3',
      missed_calls: '1',
      prio: 'high',
    });
    expect(m.android).toEqual({
      priority: 'HIGH',
      notification: {
        title: 'Trinity',
        body: 'New message',
        channel_id: 'messages',
        tag: '!r:x',
        notification_count: 3,
      },
    });
    expect(m.apns.headers).toEqual({
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-collapse-id': await sha256Hex('!r:x'),
    });
    expect(m.apns.payload.aps).toEqual({
      alert: { title: 'Trinity', body: 'New message' },
      badge: 3,
      sound: 'default',
      'mutable-content': 1,
      'thread-id': '!r:x',
    });
  });

  it('device mode sends no android notification and no collapse id', async () => {
    const d = { ...dev, data: { ...dev.data, trinity_render: 'device' } };
    const m = await build(notification({ devices: [d] }), d);
    expect(m.android.notification).toBeUndefined();
    expect(m.apns.headers).not.toHaveProperty('apns-collapse-id');
    expect(m.apns.payload.aps).toMatchObject({
      alert: { title: 'Trinity', body: 'New message' },
      'mutable-content': 1,
    });
    expect(m.data).not.toHaveProperty('trinity_render');
  });

  it('falls back on an unknown trinity_render', async () => {
    const d = { ...dev, data: { ...dev.data, trinity_render: 'foo' } };
    const m = await build(notification({ devices: [d] }), d);
    expect(m.android.notification).toBeDefined();
    expect(m.data).not.toHaveProperty('trinity_render');
  });

  it.each([
    ['absent', undefined],
    ['low', 'low'],
    ['other', 'HIGH'],
  ])('maps %s prio to normal', async (_name, prio) => {
    const base = notification();
    const n =
      prio === undefined ? withoutKeys(base, 'prio') : { ...base, prio };
    const m = await build(n);
    expect(m.android.priority).toBe('NORMAL');
    expect(m.apns.headers['apns-priority']).toBe('5');
  });

  it('sends unread 0', async () => {
    const m = await build(notification({ counts: { unread: 0 } }));
    expect(m.data.unread).toBe('0');
    expect(m.apns.payload.aps.badge).toBe(0);
    expect(m.android.notification?.notification_count).toBe(0);
  });

  it('omits absent fields', async () => {
    const m = await build(withoutKeys(notification(), 'counts', 'room_id'));
    for (const key of ['unread', 'missed_calls', 'room_id']) {
      expect(m.data).not.toHaveProperty(key);
    }
    expect(m.apns.payload.aps).not.toHaveProperty('badge');
    expect(m.apns.payload.aps).not.toHaveProperty('thread-id');
    expect(m.android.notification).not.toHaveProperty('tag');
    expect(m.android.notification).not.toHaveProperty('notification_count');
    expect(m.apns.headers).not.toHaveProperty('apns-collapse-id');
    for (const value of Object.values(m.data)) {
      expect(typeof value).toBe('string');
    }
  });

  it('omits a non-string trinity_user_id', async () => {
    const d = { ...dev, data: { trinity_user_id: 42 } };
    const m = await build(notification({ devices: [d] }), d);
    expect(m.data).not.toHaveProperty('trinity_user_id');
  });

  it('sends only a badge for an event-less notification with unread', async () => {
    const m = await build(
      withoutKeys(notification({ counts: { unread: 0 } }), 'event_id'),
    );
    expect(m.apns.payload.aps).toEqual({ badge: 0 });
    expect(m.android.notification).toBeUndefined();
    expect(m.data.unread).toBe('0');
    expect(m.apns.headers).not.toHaveProperty('apns-collapse-id');
  });

  it('returns null for an event-less notification without unread', async () => {
    const n = withoutKeys(
      notification({ counts: { missed_calls: 1 } }),
      'event_id',
    );
    expect(await buildFcmMessage(n, dev)).toBeNull();
    expect(
      await buildFcmMessage(withoutKeys(n, 'event_id', 'counts'), dev),
    ).toBeNull();
  });

  it('handles a long room id', async () => {
    const roomId = '!' + 'a'.repeat(299);
    const m = await build(notification({ room_id: roomId }));
    expect(m.apns.headers['apns-collapse-id']).toMatch(/^[0-9a-f]{64}$/);
    expect(m.apns.payload.aps['thread-id']).toBe(roomId);
  });
});
