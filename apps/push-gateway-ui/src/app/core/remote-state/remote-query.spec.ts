import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { type Observable, of, Subject, throwError } from 'rxjs';
import { ADMIN_PROBLEM_CATALOG } from '../../api/admin-contract.generated';
import { RemoteQuery } from './remote-query';

class VisibilityDocument extends EventTarget {
  hidden: boolean;

  constructor(hidden = false) {
    super();
    this.hidden = hidden;
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

describe('RemoteQuery', () => {
  let documentRef: VisibilityDocument;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    documentRef = new VisibilityDocument();
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: documentRef }],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  const query = <T>(request: () => Observable<T>): RemoteQuery<T> =>
    TestBed.runInInjectionContext(() => new RemoteQuery(request));

  it('owns first-load errors and explicit retry', async () => {
    const initialResponse = new Subject<string>();
    let response: Observable<string> = initialResponse;
    const remote = query(() => response);

    expect(remote.state()).toEqual({ kind: 'idle' });
    vi.advanceTimersByTime(0);
    expect(remote.state()).toEqual({ kind: 'loading' });
    initialResponse.error(
      new HttpErrorResponse({
        status: 503,
        error: {
          code: 'admin_unavailable',
          ...ADMIN_PROBLEM_CATALOG.admin_unavailable,
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(remote.state()).toEqual({
      kind: 'error',
      problem: { title: 'Administration unavailable', status: 503 },
    });
    expect(remote.data()).toBeUndefined();

    response = of('ready');
    vi.setSystemTime(2_000);
    await remote.refresh();

    expect(remote.state()).toEqual({
      kind: 'fresh',
      data: 'ready',
      observedAt: 2_000,
    });
    expect(remote.data()).toBe('ready');
  });

  it('preserves stale data and replaces it after retry', async () => {
    let response: Observable<{ total: number }> = of({ total: 7 });
    const remote = query(() => response);
    await vi.advanceTimersByTimeAsync(0);

    response = throwError(
      () =>
        new HttpErrorResponse({
          status: 504,
          error: {
            code: 'operation_timeout',
            ...ADMIN_PROBLEM_CATALOG.operation_timeout,
          },
        }),
    );
    vi.setSystemTime(2_000);
    await remote.refresh();
    expect(remote.state()).toEqual({
      kind: 'stale',
      data: { total: 7 },
      observedAt: 1_000,
      problem: { title: 'Operation timed out', status: 504 },
    });
    expect(remote.data()).toEqual({ total: 7 });

    response = of({ total: 8 });
    vi.setSystemTime(3_000);
    await remote.refresh();
    expect(remote.state()).toEqual({
      kind: 'fresh',
      data: { total: 8 },
      observedAt: 3_000,
    });
  });

  it('loads on a hidden-to-visible transition and polls only while visible', async () => {
    documentRef.hidden = true;
    let requestCount = 0;
    const remote = query(() => of(++requestCount));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(requestCount).toBe(0);
    expect(remote.state()).toEqual({ kind: 'idle' });

    documentRef.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(requestCount).toBe(1);
    expect(remote.data()).toBe(1);

    documentRef.setHidden(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(requestCount).toBe(1);

    documentRef.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(requestCount).toBe(2);
    expect(remote.data()).toBe(2);
  });

  it('suppresses overlapping automatic and explicit refresh attempts', async () => {
    const responses: Subject<string>[] = [];
    const remote = query(() => {
      const response = new Subject<string>();
      responses.push(response);
      return response;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(responses).toHaveLength(1);
    expect(remote.state()).toEqual({ kind: 'loading' });

    const first = remote.refresh();
    const second = remote.refresh();
    expect(first).toBe(second);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(responses).toHaveLength(1);

    responses[0]?.next('first');
    responses[0]?.complete();
    await first;
    expect(remote.data()).toBe('first');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(responses).toHaveLength(2);
    const next = remote.refresh();
    responses[1]?.next('second');
    responses[1]?.complete();
    await next;
    expect(remote.data()).toBe('second');
  });

  it('queues the latest keyed request behind an older in-flight request', async () => {
    let key = 'current';
    const responses: Subject<string>[] = [];
    const remote = TestBed.runInInjectionContext(
      () =>
        new RemoteQuery(
          () => {
            const response = new Subject<string>();
            responses.push(response);
            return response;
          },
          { requestKey: () => key },
        ),
    );
    await vi.advanceTimersByTimeAsync(0);

    key = 'historical';
    const first = remote.refresh();
    const second = remote.refresh();
    expect(first).toBe(second);
    expect(responses).toHaveLength(1);

    responses[0]?.next('current');
    responses[0]?.complete();
    await vi.advanceTimersByTimeAsync(0);
    expect(responses).toHaveLength(2);

    responses[1]?.next('historical');
    responses[1]?.complete();
    await first;
    expect(remote.data()).toBe('historical');
  });

  it('uses the production polling predicate without blocking explicit refresh', async () => {
    let automaticRefresh = false;
    let requestCount = 0;
    const remote = TestBed.runInInjectionContext(
      () =>
        new RemoteQuery(() => of(++requestCount), {
          automaticRefreshWhen: () => automaticRefresh,
        }),
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect(requestCount).toBe(0);

    await remote.refresh();
    expect(requestCount).toBe(1);

    automaticRefresh = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requestCount).toBe(2);
  });
});
