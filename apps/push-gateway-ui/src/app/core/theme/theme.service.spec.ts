import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

const STORAGE_KEY = 'trinity-push-gateway-theme';

class FakeMediaQueryList extends EventTarget implements MediaQueryList {
  readonly media = '(prefers-color-scheme: dark)';
  matches: boolean;
  onchange:
    ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null =
    null;

  constructor(matches: boolean) {
    super();
    this.matches = matches;
  }

  addListener(
    callback:
      ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null,
  ): void {
    if (callback) {
      this.addEventListener('change', callback as EventListener);
    }
  }

  removeListener(
    callback:
      ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null,
  ): void {
    if (callback) {
      this.removeEventListener('change', callback as EventListener);
    }
  }

  setMatches(matches: boolean): void {
    this.matches = matches;
    const event = new Event('change');
    Object.defineProperties(event, {
      matches: { value: matches },
      media: { value: this.media },
    });
    this.dispatchEvent(event);
  }
}

describe('ThemeService', () => {
  let mediaQuery: FakeMediaQueryList;

  beforeEach(() => {
    mediaQuery = new FakeMediaQueryList(false);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mediaQuery),
    );
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
    document.documentElement.style.removeProperty('color-scheme');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores and applies a persisted theme preference', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');

    const service = TestBed.inject(ThemeService);
    TestBed.tick();

    expect(service.preference()).toBe('dark');
    expect(service.resolved()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('tracks system theme changes while the system preference is active', () => {
    const service = TestBed.inject(ThemeService);
    TestBed.tick();

    expect(service.preference()).toBe('system');
    expect(service.resolved()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    mediaQuery.setMatches(true);
    TestBed.tick();

    expect(service.resolved()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('cycles and persists system, light, and dark preferences', () => {
    const service = TestBed.inject(ThemeService);

    service.cyclePreference();
    TestBed.tick();
    expect(service.preference()).toBe('light');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light');

    service.cyclePreference();
    TestBed.tick();
    expect(service.preference()).toBe('dark');

    service.cyclePreference();
    TestBed.tick();
    expect(service.preference()).toBe('system');
  });
});
