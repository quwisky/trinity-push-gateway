import { TestBed } from '@angular/core/testing';
import { TimeService } from './time.service';

describe('TimeService', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('uses browser-local time by default and persists the UTC toggle', () => {
    const service = TestBed.inject(TimeService);

    expect(service.preference()).toBe('local');
    expect(service.zoneLabel().length).toBeGreaterThan(0);

    service.togglePreference();
    TestBed.tick();

    expect(service.preference()).toBe('utc');
    expect(service.zoneLabel()).toBe('UTC');
    expect(window.localStorage.getItem('trinity-push-gateway-time')).toBe(
      'utc',
    );
    expect(service.format('2026-08-31T12:34:56Z')).toContain('2026');
  });

  it('converts browser-local datetime controls to normalized UTC safely', () => {
    const service = TestBed.inject(TimeService);
    const source = new Date('2026-08-31T12:34:00Z');
    const local = service.toDateTimeLocal(source);

    expect(service.fromDateTimeLocal(local)).toBe(source.toISOString());
    expect(service.fromDateTimeLocal('not-a-date')).toBeUndefined();
    expect(service.format('not-a-date')).toBe('Invalid timestamp');
  });
});
