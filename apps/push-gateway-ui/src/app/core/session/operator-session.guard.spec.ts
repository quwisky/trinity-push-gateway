import { TestBed } from '@angular/core/testing';
import {
  type GuardResult,
  Router,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { firstValueFrom, isObservable } from 'rxjs';
import { operatorSessionGuard } from './operator-session.guard';
import {
  OperatorSessionStore,
  type OperatorSessionStatus,
} from './operator-session.store';

describe('operatorSessionGuard', () => {
  let nextStatus: OperatorSessionStatus;
  let router: Router;

  const ensureAuthenticated = vi.fn((): Promise<OperatorSessionStatus> =>
    Promise.resolve(nextStatus),
  );

  beforeEach(() => {
    nextStatus = 'authenticated';
    ensureAuthenticated.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: OperatorSessionStore,
          useValue: { ensureAuthenticated },
        },
      ],
    });
    router = TestBed.inject(Router);
  });

  const runGuard = async (url = '/metrics'): Promise<GuardResult> => {
    router.routerState.snapshot.url = url;
    const result = TestBed.runInInjectionContext(() =>
      operatorSessionGuard(
        router.routerState.snapshot.root,
        router.routerState.snapshot,
      ),
    );

    return isObservable(result) ? firstValueFrom(result) : await result;
  };

  it('allows an authenticated Operator Session', async () => {
    await expect(runGuard()).resolves.toBe(true);
    expect(ensureAuthenticated).toHaveBeenCalledOnce();
  });

  it.each<{
    status: Extract<
      OperatorSessionStatus,
      'unauthenticated' | 'forbidden' | 'unavailable'
    >;
    scenario: string;
  }>([
    { status: 'unauthenticated', scenario: 'a 401 response' },
    { status: 'forbidden', scenario: 'a 403 response' },
    { status: 'unavailable', scenario: 'an unavailable administration API' },
  ])('redirects after $scenario', async ({ status }) => {
    nextStatus = status;

    const result = await runGuard();

    expect(result).toBeInstanceOf(UrlTree);
    if (!(result instanceof UrlTree)) {
      throw new Error('Expected the session guard to return a UrlTree.');
    }
    expect(router.serializeUrl(result)).toBe(
      `/sign-in?reason=${status}&returnPath=%2Fadmin%2Fmetrics`,
    );
  });
});
