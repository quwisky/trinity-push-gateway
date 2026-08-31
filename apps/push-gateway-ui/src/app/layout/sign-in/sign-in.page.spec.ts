import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { SignInPage } from './sign-in.page';

describe('SignInPage', () => {
  it.each([
    ['/admin/metrics', '/admin/auth/login?returnPath=%2Fadmin%2Fmetrics'],
    ['https://attacker.example/admin/metrics', '/admin/auth/login'],
    [null, '/admin/auth/login'],
  ])(
    'builds a same-origin login link for return path %s',
    async (returnPath, expected) => {
      await TestBed.configureTestingModule({
        imports: [SignInPage],
        providers: [
          {
            provide: ActivatedRoute,
            useValue: {
              snapshot: {
                queryParamMap: convertToParamMap({
                  reason: 'unauthenticated',
                  ...(returnPath === null ? {} : { returnPath }),
                }),
              },
            },
          },
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(SignInPage);
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement)
          .querySelector('a.primary-action')
          ?.getAttribute('href'),
      ).toBe(expected);
    },
  );
});
