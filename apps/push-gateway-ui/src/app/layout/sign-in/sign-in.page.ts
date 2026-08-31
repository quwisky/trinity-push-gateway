import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

type SignInReason = 'unauthenticated' | 'forbidden' | 'unavailable';

const isSignInReason = (value: string | null): value is SignInReason =>
  value === 'unauthenticated' ||
  value === 'forbidden' ||
  value === 'unavailable';

@Component({
  selector: 'tpg-sign-in-page',
  template: `
    <main id="main-content" class="auth-layout" tabindex="-1">
      <section class="auth-card" aria-labelledby="sign-in-title">
        <p class="eyebrow">Self-hosted operations</p>
        <h1 id="sign-in-title">Trinity Push Gateway</h1>
        <p class="lede">Observe and operate this Push Gateway privately.</p>

        @switch (reason) {
          @case ('forbidden') {
            <p class="status-message" role="alert">
              This Operator Identity is not allowed to use this deployment.
            </p>
          }
          @case ('unavailable') {
            <p class="status-message" role="alert">
              The administration service is not available. Notification delivery
              remains independent.
            </p>
          }
          @default {
            <p class="muted">
              Continue through the identity provider configured by the Gateway
              Operator.
            </p>
          }
        }

        <a class="primary-action" href="/admin/auth/login">
          Continue to sign in
        </a>
        <p class="auth-note">
          Authentication uses this deployment's same-origin OIDC route.
        </p>
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInPage {
  private readonly route = inject(ActivatedRoute);
  protected readonly reason = isSignInReason(
    this.route.snapshot.queryParamMap.get('reason'),
  )
    ? this.route.snapshot.queryParamMap.get('reason')
    : 'unauthenticated';
}
