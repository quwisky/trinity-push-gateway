import { describe, expect, it } from 'bun:test';

import {
  hasSustainedAdministrationRegression,
  summarizeAdministrationIsolationSeries,
} from '../../../scripts/benchmark-admin-isolation-policy';

describe('administration isolation benchmark policy', () => {
  it('requires a separate confirmation for a noisy regressed series', () => {
    const noisy = summarizeAdministrationIsolationSeries([
      { disabledP95Ms: 193.805, enabledP95Ms: 226.135 },
      { disabledP95Ms: 75.084, enabledP95Ms: 248.795 },
      { disabledP95Ms: 71.692, enabledP95Ms: 186.33 },
      { disabledP95Ms: 61.868, enabledP95Ms: 45.915 },
      { disabledP95Ms: 59.949, enabledP95Ms: 45.754 },
    ]);
    const stable = summarizeAdministrationIsolationSeries([
      { disabledP95Ms: 13.304, enabledP95Ms: 18.126 },
      { disabledP95Ms: 20.34, enabledP95Ms: 20.532 },
      { disabledP95Ms: 13.304, enabledP95Ms: 18.871 },
      { disabledP95Ms: 9.846, enabledP95Ms: 10.286 },
      { disabledP95Ms: 11.418, enabledP95Ms: 11.432 },
    ]);

    expect(noisy.requiresConfirmation).toBe(true);
    expect(stable.requiresConfirmation).toBe(false);
    expect(hasSustainedAdministrationRegression(noisy, stable)).toBe(false);
  });

  it('rejects the same administration regression in both series', () => {
    const first = summarizeAdministrationIsolationSeries(
      Array.from({ length: 5 }, () => ({
        disabledP95Ms: 20,
        enabledP95Ms: 30,
      })),
    );
    const confirmation = summarizeAdministrationIsolationSeries(
      Array.from({ length: 5 }, () => ({
        disabledP95Ms: 18,
        enabledP95Ms: 27,
      })),
    );

    expect(first.requiresConfirmation).toBe(true);
    expect(confirmation.requiresConfirmation).toBe(true);
    expect(hasSustainedAdministrationRegression(first, confirmation)).toBe(
      true,
    );
  });

  it('does not confirm one noisy round', () => {
    const summary = summarizeAdministrationIsolationSeries([
      { disabledP95Ms: 10, enabledP95Ms: 100 },
      { disabledP95Ms: 10, enabledP95Ms: 10 },
      { disabledP95Ms: 10, enabledP95Ms: 10 },
      { disabledP95Ms: 10, enabledP95Ms: 10 },
      { disabledP95Ms: 10, enabledP95Ms: 10 },
    ]);

    expect(summary.requiresConfirmation).toBe(false);
  });
});
