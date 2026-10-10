import { sha256Hex } from './hash';
import type { Device, Notification } from './notify/parse';

export const FALLBACK_TITLE = 'Trinity';
export const FALLBACK_BODY = 'New message';
const ANDROID_CHANNEL_ID = 'messages';

export interface FcmMessage {
  token: string;
  data: Record<string, string>;
  android: {
    priority: 'HIGH' | 'NORMAL';
    notification?: {
      title: string;
      body: string;
      channel_id: string;
      tag?: string;
      notification_count?: number;
    };
  };
  apns: {
    headers: Record<string, string>;
    payload: { aps: Record<string, unknown> };
  };
}

function buildData(n: Notification, d: Device): Record<string, string> {
  const data: Record<string, string> = {};
  if (n.event_id !== undefined) data.event_id = n.event_id;
  if (n.room_id !== undefined) data.room_id = n.room_id;
  const userId = d.data.trinity_user_id;
  if (typeof userId === 'string') data.trinity_user_id = userId;
  if (n.counts?.unread !== undefined) data.unread = String(n.counts.unread);
  if (n.counts?.missed_calls !== undefined) {
    data.missed_calls = String(n.counts.missed_calls);
  }
  if (n.prio !== undefined) data.prio = n.prio;
  return data;
}

/**
 * Builds the FCM HTTP v1 message for one device. It carries both an `android`
 * and an `apns` block; FCM applies the one matching the token's platform.
 * Returns null when there is nothing to deliver (no event and no unread count).
 */
export async function buildFcmMessage(
  n: Notification,
  d: Device,
): Promise<FcmMessage | null> {
  const unread = n.counts?.unread;
  const hasEvent = n.event_id !== undefined;
  if (!hasEvent && unread === undefined) return null;

  const high = n.prio === 'high';
  const deviceRender = d.data.trinity_render === 'device';

  const headers: Record<string, string> = {
    'apns-push-type': 'alert',
    'apns-priority': high ? '10' : '5',
  };
  const aps: Record<string, unknown> = {};
  const android: FcmMessage['android'] = {
    priority: high ? 'HIGH' : 'NORMAL',
  };

  if (unread !== undefined) aps.badge = unread;
  if (hasEvent) {
    aps.alert = { title: FALLBACK_TITLE, body: FALLBACK_BODY };
    aps.sound = 'default';
    aps['mutable-content'] = 1;
    if (n.room_id !== undefined) aps['thread-id'] = n.room_id;
  }

  // Fallback mode: one notification per room, replaced in place. Device mode
  // leaves rendering to the app (Android) and the extension (iOS).
  if (hasEvent && !deviceRender) {
    android.notification = {
      title: FALLBACK_TITLE,
      body: FALLBACK_BODY,
      channel_id: ANDROID_CHANNEL_ID,
      ...(n.room_id !== undefined && { tag: n.room_id }),
      ...(unread !== undefined && { notification_count: unread }),
    };
    if (n.room_id !== undefined) {
      headers['apns-collapse-id'] = await sha256Hex(n.room_id);
    }
  }

  return {
    token: d.pushkey,
    data: buildData(n, d),
    android,
    apns: { headers, payload: { aps } },
  };
}
