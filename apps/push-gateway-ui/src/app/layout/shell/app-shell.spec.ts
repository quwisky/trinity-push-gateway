import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { OperatorSession } from '../../api/generated/admin-api.schemas';
import { OperatorSessionStore } from '../../core/session/operator-session.store';
import { ThemeService } from '../../core/theme/theme.service';
import { AppShell } from './app-shell';

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

describe('AppShell', () => {
  const cyclePreference = vi.fn();

  beforeEach(async () => {
    cyclePreference.mockClear();
    await TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [
        provideRouter([]),
        {
          provide: OperatorSessionStore,
          useValue: { session: signal<OperatorSession | undefined>(SESSION) },
        },
        {
          provide: ThemeService,
          useValue: {
            preference: signal('system'),
            cyclePreference,
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the five primary navigation destinations and main landmark', () => {
    const fixture = TestBed.createComponent(AppShell);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const navigation = root.querySelector('nav[aria-label="Primary"]');
    const links = Array.from(navigation?.querySelectorAll('a') ?? []);

    expect(links.map((link) => link.textContent.trim())).toEqual([
      'Overview',
      'Metrics',
      'Operations',
      'Configuration',
      'Security',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/overview',
      '/metrics',
      '/operations',
      '/configuration',
      '/security',
    ]);

    const main = root.querySelector('main#main-content');
    expect(main?.getAttribute('tabindex')).toBe('-1');
    expect(root.textContent).toContain('Gateway Operator');
  });

  it('exposes the responsive navigation and theme controls accessibly', () => {
    const fixture = TestBed.createComponent(AppShell);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const menuButton = root.querySelector(
      'button[aria-controls="primary-navigation"]',
    );
    const themeButton = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent.includes('Theme:'),
    );

    expect(menuButton?.getAttribute('aria-expanded')).toBe('false');
    menuButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(menuButton?.getAttribute('aria-expanded')).toBe('true');

    themeButton?.click();
    expect(cyclePreference).toHaveBeenCalledOnce();
  });
});
