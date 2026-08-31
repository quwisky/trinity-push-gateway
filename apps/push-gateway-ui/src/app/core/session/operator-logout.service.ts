import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { StatusAnnouncer } from '../status/status-announcer';
import { OperatorSessionStore } from './operator-session.store';

@Injectable({ providedIn: 'root' })
export class OperatorLogoutService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly sessionStore = inject(OperatorSessionStore);
  private readonly announcer = inject(StatusAnnouncer);

  async logout(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post('/admin/auth/logout', null, { responseType: 'text' }),
      );
    } catch {
      // The server revokes locally before its best-effort provider redirect.
      // A cross-origin redirect can surface as an XHR error after revocation.
    } finally {
      this.sessionStore.clear();
      this.announcer.announce('Operator Session ended.');
      await this.router.navigate(['/sign-in'], {
        queryParams: { reason: 'unauthenticated' },
      });
    }
  }
}
