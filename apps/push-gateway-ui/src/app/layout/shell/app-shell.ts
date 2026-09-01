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
  templateUrl: './app-shell.html',
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
