import { DOCUMENT } from '@angular/common';
import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
} from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedTheme = Exclude<ThemePreference, 'system'>;

const STORAGE_KEY = 'trinity-push-gateway-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'system' || value === 'light' || value === 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly browserWindow = this.document.defaultView;
  private readonly mediaQuery = this.browserWindow?.matchMedia(DARK_QUERY);
  private readonly systemIsDark = signal(this.mediaQuery?.matches ?? false);

  readonly preference = signal<ThemePreference>(this.readPreference());
  readonly resolved = computed<ResolvedTheme>(() => {
    const preference = this.preference();
    return preference === 'system'
      ? this.systemIsDark()
        ? 'dark'
        : 'light'
      : preference;
  });

  constructor() {
    this.mediaQuery?.addEventListener('change', this.handleSystemThemeChange);
    this.destroyRef.onDestroy(() =>
      this.mediaQuery?.removeEventListener(
        'change',
        this.handleSystemThemeChange,
      ),
    );

    effect(() => {
      const preference = this.preference();
      const resolved = this.resolved();
      const root = this.document.documentElement;
      root.dataset['theme'] = resolved;
      root.style.colorScheme = resolved;
      root.classList.toggle('dark', resolved === 'dark');

      try {
        this.browserWindow?.localStorage.setItem(STORAGE_KEY, preference);
      } catch {
        // Theme persistence is optional when browser storage is unavailable.
      }
    });
  }

  setPreference(preference: ThemePreference): void {
    this.preference.set(preference);
  }

  cyclePreference(): void {
    const order: readonly ThemePreference[] = ['system', 'light', 'dark'];
    const currentIndex = order.indexOf(this.preference());
    this.preference.set(order[(currentIndex + 1) % order.length] ?? 'system');
  }

  private readonly handleSystemThemeChange = (
    event: MediaQueryListEvent,
  ): void => {
    this.systemIsDark.set(event.matches);
  };

  private readPreference(): ThemePreference {
    try {
      const stored = this.browserWindow?.localStorage.getItem(STORAGE_KEY);
      return isThemePreference(stored) ? stored : 'system';
    } catch {
      return 'system';
    }
  }
}
