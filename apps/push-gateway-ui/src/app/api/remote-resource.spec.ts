import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { ADMIN_PROBLEM_CATALOG } from './admin-contract.generated';
import { RemoteResource } from './remote-resource';

describe('RemoteResource', () => {
  it('waits for a single-response transport to complete', async () => {
    const resource = new RemoteResource<string>();
    const response = new Subject<string>();

    const resultPromise = resource.load(() => response);
    response.next('ready');
    await Promise.resolve();

    expect(resource.state()).toEqual({ kind: 'loading' });
    response.complete();
    await expect(resultPromise).resolves.toMatchObject({
      kind: 'fresh',
      data: 'ready',
    });
  });

  it('moves from idle through loading to a first-load error', async () => {
    const resource = new RemoteResource<string>();
    const response = new Subject<string>();

    expect(resource.state()).toEqual({ kind: 'idle' });

    const resultPromise = resource.load(() => response);
    expect(resource.state()).toEqual({ kind: 'loading' });

    response.error(
      new HttpErrorResponse({
        status: 503,
        error: {
          code: 'admin_unavailable',
          ...ADMIN_PROBLEM_CATALOG.admin_unavailable,
        },
      }),
    );

    await expect(resultPromise).resolves.toEqual({
      kind: 'error',
      problem: {
        title: 'Administration unavailable',
        status: 503,
      },
    });
    expect(resource.state()).toEqual({
      kind: 'error',
      problem: {
        title: 'Administration unavailable',
        status: 503,
      },
    });
  });

  it('preserves a successful observation as stale when refresh fails', async () => {
    const resource = new RemoteResource<{ total: number }>();

    await resource.load(
      () => of({ total: 7 }),
      () => 100,
    );
    const result = await resource.load(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 504,
            error: {
              code: 'operation_timeout',
              ...ADMIN_PROBLEM_CATALOG.operation_timeout,
            },
          }),
      ),
    );

    expect(result).toEqual({
      kind: 'stale',
      data: { total: 7 },
      observedAt: 100,
      problem: { title: 'Operation timed out', status: 504 },
    });
    expect(resource.state()).toEqual(result);
  });

  it('replaces stale data after a successful retry', async () => {
    const resource = new RemoteResource<string>();

    await resource.load(
      () => of('first'),
      () => 10,
    );
    await resource.load(() => throwError(() => new Error('offline')));

    const result = await resource.load(
      () => of('second'),
      () => 20,
    );

    expect(result).toEqual({
      kind: 'fresh',
      data: 'second',
      observedAt: 20,
    });
    expect(resource.state()).toEqual(result);
  });
});
