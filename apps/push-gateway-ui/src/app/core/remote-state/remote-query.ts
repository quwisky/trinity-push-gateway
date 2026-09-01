import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, inject, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  distinctUntilChanged,
  fromEvent,
  map,
  merge,
  NEVER,
  type Observable,
  of,
  switchMap,
  timer,
} from 'rxjs';
import { RemoteResource, type RemoteState } from '../../api/remote-resource';

const POLL_INTERVAL_MILLISECONDS = 30_000;

type RemoteQueryOptions = Readonly<{
  automaticRefreshWhen?: () => boolean;
  requestKey?: () => unknown;
}>;

type InFlightRequest<T> = Readonly<{
  key: unknown;
  promise: Promise<RemoteState<T>>;
}>;

export class RemoteQuery<T> {
  private readonly resource = new RemoteResource<T>();
  private readonly destroyRef = inject(DestroyRef);
  private readonly documentRef = inject(DOCUMENT);
  private readonly request: () => Observable<T>;
  private readonly automaticRefreshWhen: () => boolean;
  private readonly requestKey: () => unknown;
  private inFlight: InFlightRequest<T> | undefined;
  private queuedRefresh: Promise<RemoteState<T>> | undefined;

  readonly state: Signal<RemoteState<T>> = this.resource.state;
  readonly data: Signal<T | undefined> = computed(() => {
    const state = this.state();
    return state.kind === 'fresh' || state.kind === 'stale'
      ? state.data
      : undefined;
  });

  constructor(request: () => Observable<T>, options: RemoteQueryOptions = {}) {
    this.request = request;
    this.automaticRefreshWhen = options.automaticRefreshWhen ?? (() => true);
    this.requestKey = options.requestKey ?? (() => undefined);

    merge(
      of(!this.documentRef.hidden),
      fromEvent(this.documentRef, 'visibilitychange').pipe(
        map(() => !this.documentRef.hidden),
      ),
    )
      .pipe(
        distinctUntilChanged(),
        switchMap((visible) =>
          visible ? timer(0, POLL_INTERVAL_MILLISECONDS) : NEVER,
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (this.automaticRefreshWhen()) {
          void this.refresh();
        }
      });
  }

  refresh(): Promise<RemoteState<T>> {
    const key = this.requestKey();
    const current = this.inFlight;
    if (current) {
      return Object.is(current.key, key)
        ? current.promise
        : this.queueRefresh(current.promise);
    }

    const pending = this.resource.load(this.request);
    const inFlight = { key, promise: pending };
    this.inFlight = inFlight;
    const clear = (): void => {
      if (this.inFlight === inFlight) {
        this.inFlight = undefined;
      }
    };
    void pending.then(clear, clear);
    return pending;
  }

  private queueRefresh(
    current: Promise<RemoteState<T>>,
  ): Promise<RemoteState<T>> {
    if (this.queuedRefresh) {
      return this.queuedRefresh;
    }

    const run = (): Promise<RemoteState<T>> => {
      this.queuedRefresh = undefined;
      return this.refresh();
    };
    const queued = current.then(run, run);
    this.queuedRefresh = queued;
    return queued;
  }
}
