import type { Outcome } from './providers/fcm';

/**
 * One line per device. Only the app ID, outcome class and FCM status/code are
 * logged: never pushkeys, Matrix IDs or tokens.
 */
export function logDelivery(e: {
  appId: string;
  outcome: Outcome | 'throttled' | 'skipped' | 'unknown_app';
  status?: number;
  code?: string;
}): void {
  console.log(JSON.stringify({ event: 'delivery', ...e }));
}
