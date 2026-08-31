import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'tpg-not-found-page',
  imports: [RouterLink],
  template: `
    <main id="main-content" class="auth-layout" tabindex="-1">
      <section class="auth-card">
        <p class="eyebrow">404</p>
        <h1>Page not found</h1>
        <p class="muted">This route is not part of the Push Gateway UI.</p>
        <a class="primary-action" routerLink="/overview">Return to overview</a>
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {}
