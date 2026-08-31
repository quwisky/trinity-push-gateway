import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { OperatorSession } from '../../api/generated/admin-api.schemas';
import { SessionService } from '../../api/generated/session/session.service';

export type OperatorSessionStatus =
  | 'unknown'
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  | 'forbidden'
  | 'unavailable';

@Injectable({ providedIn: 'root' })
export class OperatorSessionStore {
  private readonly sessionApi = inject(SessionService);
  private pendingRequest?: Promise<OperatorSessionStatus>;

  readonly status = signal<OperatorSessionStatus>('unknown');
  readonly session = signal<OperatorSession | undefined>(undefined);

  ensureAuthenticated(): Promise<OperatorSessionStatus> {
    if (this.status() === 'authenticated') {
      return Promise.resolve('authenticated');
    }
    if (this.pendingRequest) {
      return this.pendingRequest;
    }

    this.status.set('loading');
    this.pendingRequest = this.loadSession();
    return this.pendingRequest;
  }

  clear(): void {
    this.session.set(undefined);
    this.status.set('unknown');
  }

  private async loadSession(): Promise<OperatorSessionStatus> {
    try {
      const session = await firstValueFrom(this.sessionApi.getSession());
      this.session.set(session);
      this.status.set('authenticated');
      return 'authenticated';
    } catch (error) {
      this.session.set(undefined);
      const status = classifySessionFailure(error);
      this.status.set(status);
      return status;
    } finally {
      this.pendingRequest = undefined;
    }
  }
}

const classifySessionFailure = (error: unknown): OperatorSessionStatus => {
  if (!(error instanceof HttpErrorResponse)) {
    return 'unavailable';
  }
  if (error.status === 401) {
    return 'unauthenticated';
  }
  if (error.status === 403) {
    return 'forbidden';
  }
  return 'unavailable';
};
