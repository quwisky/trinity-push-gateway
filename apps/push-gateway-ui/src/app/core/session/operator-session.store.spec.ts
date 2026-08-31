import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import type { OperatorSession } from '../../api/generated/admin-api.schemas';
import { SessionService } from '../../api/generated/session/session.service';
import {
  OperatorSessionStore,
  type OperatorSessionStatus,
} from './operator-session.store';

const SESSION: OperatorSession = {
  id: 'session_identifier_1234',
  operator: {
    issuer: 'https://identity.example.test',
    subject: 'operator-1',
    displayName: 'Gateway Operator',
  },
  createdAt: '2026-08-31T10:00:00Z',
  lastSeenAt: '2026-08-31T10:05:00Z',
  idleExpiresAt: '2026-08-31T11:05:00Z',
  absoluteExpiresAt: '2026-09-01T10:00:00Z',
  current: true,
};

describe('OperatorSessionStore', () => {
  let response: Observable<OperatorSession>;
  let store: OperatorSessionStore;

  beforeEach(() => {
    response = of(SESSION);
    TestBed.configureTestingModule({
      providers: [
        OperatorSessionStore,
        {
          provide: SessionService,
          useValue: {
            getSession: (): Observable<OperatorSession> => response,
          },
        },
      ],
    });
    store = TestBed.inject(OperatorSessionStore);
  });

  it('retains an authenticated Operator Session', async () => {
    await expect(store.ensureAuthenticated()).resolves.toBe('authenticated');

    expect(store.status()).toBe('authenticated');
    expect(store.session()).toEqual(SESSION);
  });

  it.each<{
    httpStatus: number;
    expected: OperatorSessionStatus;
  }>([
    { httpStatus: 401, expected: 'unauthenticated' },
    { httpStatus: 403, expected: 'forbidden' },
    { httpStatus: 503, expected: 'unavailable' },
  ])(
    'classifies HTTP $httpStatus as $expected without retaining a session',
    async ({ httpStatus, expected }) => {
      response = throwError(
        () => new HttpErrorResponse({ status: httpStatus }),
      );

      await expect(store.ensureAuthenticated()).resolves.toBe(expected);
      expect(store.status()).toBe(expected);
      expect(store.session()).toBeUndefined();
    },
  );

  it('fails closed when the session request raises a non-HTTP error', async () => {
    response = throwError(() => new Error('network unavailable'));

    await expect(store.ensureAuthenticated()).resolves.toBe('unavailable');
    expect(store.status()).toBe('unavailable');
    expect(store.session()).toBeUndefined();
  });
});
