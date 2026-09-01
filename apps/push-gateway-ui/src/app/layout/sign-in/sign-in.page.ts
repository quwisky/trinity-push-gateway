import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

type SignInReason = 'unauthenticated' | 'forbidden' | 'unavailable';

const isSignInReason = (value: string | null): value is SignInReason =>
  value === 'unauthenticated' ||
  value === 'forbidden' ||
  value === 'unavailable';

const loginHref = (returnPath: string | null): string =>
  returnPath?.startsWith('/admin/') === true
    ? `/admin/auth/login?returnPath=${encodeURIComponent(returnPath)}`
    : '/admin/auth/login';

@Component({
  selector: 'tpg-sign-in-page',
  templateUrl: './sign-in.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInPage {
  private readonly route = inject(ActivatedRoute);
  protected readonly loginHref = loginHref(
    this.route.snapshot.queryParamMap.get('returnPath'),
  );
  protected readonly reason = isSignInReason(
    this.route.snapshot.queryParamMap.get('reason'),
  )
    ? this.route.snapshot.queryParamMap.get('reason')
    : 'unauthenticated';
}
