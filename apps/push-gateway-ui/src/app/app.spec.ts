import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('provides a keyboard skip link to the routed main landmark', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const skipLink = compiled.querySelector('a.skip-link');

    expect(skipLink).not.toBeNull();
    expect(skipLink?.textContent.trim()).toBe('Skip to main content');
    expect(skipLink?.getAttribute('href')).toBe('#main-content');
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
  });
});
