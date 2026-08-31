import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';
import {
  defer,
  exhaustMap,
  fromEvent,
  map,
  merge,
  NEVER,
  Observable,
  of,
  switchMap,
  timer,
} from 'rxjs';

export const pollWhileVisible = <T>(
  request: () => Observable<T>,
  intervalMilliseconds = 30_000,
  documentRef: Document = inject(DOCUMENT),
): Observable<T> => {
  const visibility = merge(
    of(!documentRef.hidden),
    fromEvent(documentRef, 'visibilitychange').pipe(
      map(() => !documentRef.hidden),
    ),
  );

  return visibility.pipe(
    switchMap((visible) =>
      visible
        ? timer(0, intervalMilliseconds).pipe(exhaustMap(() => defer(request)))
        : NEVER,
    ),
  );
};
