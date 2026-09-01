import { Signal, signal } from '@angular/core';
import { lastValueFrom, Observable } from 'rxjs';
import { SafeApiProblem, toSafeApiProblem } from './api-problem';

export type RemoteState<T> =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'fresh'; data: T; observedAt: number }>
  | Readonly<{
      kind: 'stale';
      data: T;
      observedAt: number;
      problem: SafeApiProblem;
    }>
  | Readonly<{ kind: 'error'; problem: SafeApiProblem }>;

export class RemoteResource<T> {
  private readonly mutableState = signal<RemoteState<T>>({ kind: 'idle' });

  readonly state: Signal<RemoteState<T>> = this.mutableState.asReadonly();

  async load(
    request: () => Observable<T>,
    now: () => number = Date.now,
  ): Promise<RemoteState<T>> {
    const previous = this.mutableState();
    const previousValue =
      previous.kind === 'fresh' || previous.kind === 'stale'
        ? previous
        : undefined;

    if (!previousValue) {
      this.mutableState.set({ kind: 'loading' });
    }

    try {
      const data = await lastValueFrom(request());
      const next = { kind: 'fresh', data, observedAt: now() } as const;
      this.mutableState.set(next);
      return next;
    } catch (error) {
      const problem = toSafeApiProblem(error);
      const next = previousValue
        ? ({
            kind: 'stale',
            data: previousValue.data,
            observedAt: previousValue.observedAt,
            problem,
          } as const)
        : ({ kind: 'error', problem } as const);
      this.mutableState.set(next);
      return next;
    }
  }
}
