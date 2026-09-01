import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { OperatorSessionStore } from './operator-session.store';

export const operatorSessionGuard: CanActivateFn = async (_route, state) => {
  const sessionStore = inject(OperatorSessionStore);
  const router = inject(Router);
  const status = await sessionStore.ensureAuthenticated();

  return status === 'authenticated'
    ? true
    : router.createUrlTree(['/sign-in'], {
        queryParams: {
          reason: status,
          returnPath: `/admin${state.url === '/' ? '/' : state.url}`,
        },
      });
};
