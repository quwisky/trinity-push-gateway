import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs';
import { OperatorLogoutService } from '../../core/session/operator-logout.service';
import { OperatorSessionStore } from '../../core/session/operator-session.store';
import { StatusAnnouncer } from '../../core/status/status-announcer';
import { ThemeService } from '../../core/theme/theme.service';
import { TimeService } from '../../core/time/time.service';
import { HlmButton } from '../../ui/helm/button';

const NAVIGATION = [
  { path: '/overview', label: 'Overview' },
  { path: '/metrics', label: 'Metrics' },
  { path: '/operations', label: 'Operations' },
  { path: '/configuration', label: 'Configuration' },
  { path: '/security', label: 'Security' },
] as const;

@Component({
  selector: 'tpg-app-shell',
  imports: [HlmButton, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="app-shell">
      <header class="app-header">
        <a
          class="wordmark"
          routerLink="/overview"
          aria-label="Trinity Push Gateway overview"
        >
          <span>Trinity</span>
          <strong>Push Gateway</strong>
        </a>
        <div class="header-actions">
          <button
            hlmBtn
            class="nav-toggle"
            variant="outline"
            type="button"
            [attr.aria-expanded]="navigationOpen()"
            aria-controls="primary-navigation"
            (click)="navigationOpen.update((open) => !open)"
          >
            {{ navigationOpen() ? 'Close menu' : 'Menu' }}
          </button>
          <button
            hlmBtn
            variant="outline"
            type="button"
            (click)="theme.cyclePreference()"
          >
            Theme: {{ theme.preference() }}
          </button>
          <button
            hlmBtn
            variant="outline"
            type="button"
            (click)="time.togglePreference()"
          >
            Times: {{ time.zoneLabel() }}
          </button>
          <button
            hlmBtn
            variant="secondary"
            type="button"
            [disabled]="logoutPending()"
            (click)="logout()"
          >
            {{ logoutPending() ? 'Signing out…' : 'Sign out' }}
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

        <div class="content-column">
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <ol>
              <li><span>Push Gateway UI</span></li>
              <li aria-current="page">{{ currentPage() }}</li>
            </ol>
          </nav>
          <main id="main-content" class="page-content" tabindex="-1">
            <router-outlet></router-outlet>
          </main>
        </div>
      </div>

      <p class="visually-hidden" aria-live="polite" aria-atomic="true">
        {{ announcer.message() }}
      </p>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly logoutService = inject(OperatorLogoutService);

  protected readonly navigation = NAVIGATION;
  protected readonly navigationOpen = signal(false);
  protected readonly logoutPending = signal(false);
  protected readonly currentPage = signal(this.pageLabel(this.router.url));
  protected readonly sessionStore = inject(OperatorSessionStore);
  protected readonly theme = inject(ThemeService);
  protected readonly time = inject(TimeService);
  protected readonly announcer = inject(StatusAnnouncer);

  constructor() {
    afterNextRender(() => {
      this.focusMain();
    });
    this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd => event instanceof NavigationEnd,
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        const page = this.pageLabel(event.urlAfterRedirects);
        this.currentPage.set(page);
        this.navigationOpen.set(false);
        queueMicrotask(() => {
          this.focusMain(page);
        });
      });
  }

  protected async logout(): Promise<void> {
    if (this.logoutPending()) {
      return;
    }
    this.logoutPending.set(true);
    await this.logoutService.logout();
  }

  private pageLabel(url: string): string {
    return (
      NAVIGATION.find(({ path }) => url.includes(path))?.label ?? 'Overview'
    );
  }

  private focusMain(page = this.currentPage()): void {
    const main = this.document.getElementById('main-content');
    main?.focus({ preventScroll: true });
    this.document.title = `${page} · Trinity Push Gateway`;
  }
}
