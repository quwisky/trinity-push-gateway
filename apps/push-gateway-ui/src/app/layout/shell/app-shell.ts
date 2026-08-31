import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { OperatorSessionStore } from '../../core/session/operator-session.store';
import { ThemeService } from '../../core/theme/theme.service';

const NAVIGATION = [
  { path: '/overview', label: 'Overview' },
  { path: '/metrics', label: 'Metrics' },
  { path: '/operations', label: 'Operations' },
  { path: '/configuration', label: 'Configuration' },
  { path: '/security', label: 'Security' },
] as const;

@Component({
  selector: 'tpg-app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="app-shell">
      <header class="app-header">
        <a class="wordmark" routerLink="/overview">
          <span>Trinity</span>
          <strong>Push Gateway</strong>
        </a>
        <div class="header-actions">
          <button
            class="secondary-action nav-toggle"
            type="button"
            [attr.aria-expanded]="navigationOpen()"
            aria-controls="primary-navigation"
            (click)="navigationOpen.update((open) => !open)"
          >
            Menu
          </button>
          <button
            class="secondary-action"
            type="button"
            (click)="theme.cyclePreference()"
          >
            Theme: {{ theme.preference() }}
          </button>
        </div>
      </header>

      <div class="shell-body">
        <nav
          id="primary-navigation"
          class="primary-navigation"
          aria-label="Primary"
          [class.is-open]="navigationOpen()"
        >
          @for (item of navigation; track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="active"
              ariaCurrentWhenActive="page"
              (click)="navigationOpen.set(false)"
            >
              {{ item.label }}
            </a>
          }
          @if (sessionStore.session(); as session) {
            <div class="operator-summary">
              <span>Operator Identity</span>
              <strong>{{
                session.operator.displayName ||
                  session.operator.email ||
                  session.operator.subject
              }}</strong>
            </div>
          }
        </nav>

        <main id="main-content" class="page-content" tabindex="-1">
          <router-outlet></router-outlet>
        </main>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  protected readonly navigation = NAVIGATION;
  protected readonly navigationOpen = signal(false);
  protected readonly sessionStore = inject(OperatorSessionStore);
  protected readonly theme = inject(ThemeService);
}
