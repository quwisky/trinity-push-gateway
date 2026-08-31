import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, signal } from '@angular/core';

export type TimePreference = 'local' | 'utc';

const STORAGE_KEY = 'trinity-push-gateway-time';

const isTimePreference = (value: unknown): value is TimePreference =>
  value === 'local' || value === 'utc';

@Injectable({ providedIn: 'root' })
export class TimeService {
  private readonly browserWindow = inject(DOCUMENT).defaultView;
  private readonly localZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'Browser local time';

  readonly preference = signal<TimePreference>(this.readPreference());
  readonly zoneLabel = computed(() =>
    this.preference() === 'utc' ? 'UTC' : this.localZone,
  );

  constructor() {
    effect(() => {
      try {
        this.browserWindow?.localStorage.setItem(
          STORAGE_KEY,
          this.preference(),
        );
      } catch {
        // Time-display persistence is optional when browser storage is unavailable.
      }
    });
  }

  togglePreference(): void {
    this.preference.update((preference) =>
      preference === 'local' ? 'utc' : 'local',
    );
  }

  format(value: string | number | Date): string {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return 'Invalid timestamp';
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      ...(this.preference() === 'utc' ? { timeZone: 'UTC' } : {}),
    }).format(date);
  }

  toDateTimeLocal(value: Date): string {
    const local = new Date(
      value.getTime() - value.getTimezoneOffset() * 60_000,
    );
    return local.toISOString().slice(0, 16);
  }

  fromDateTimeLocal(value: string): string | undefined {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }

  private readPreference(): TimePreference {
    try {
      const stored = this.browserWindow?.localStorage.getItem(STORAGE_KEY);
      return isTimePreference(stored) ? stored : 'local';
    } catch {
      return 'local';
    }
  }
}
