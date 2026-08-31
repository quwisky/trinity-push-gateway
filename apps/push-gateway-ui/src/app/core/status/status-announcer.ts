import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class StatusAnnouncer {
  readonly message = signal('');

  announce(message: string): void {
    this.message.set('');
    queueMicrotask(() => {
      this.message.set(message);
    });
  }
}
