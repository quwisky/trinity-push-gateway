import { describe, expect, it } from 'bun:test';

import {
  hasSustainedAdministrationRegression,
  summarizeAdministrationIsolationSeries,
} from '../../../scripts/benchmark-admin-isolation-policy';

describe('administration isolation benchmark policy', () => {
  it('rejects repeated three-of-five host variance as confirmation', () => {
    const initial = summarizeAdministrationIsolationSeries([
      { disabledP95Ms: 46.354, enabledP95Ms: 131.54 },
      { disabledP95Ms: 45.619, enabledP95Ms: 51.567 },
      { disabledP95Ms: 39.644, enabledP95Ms: 53.411 },
      { disabledP95Ms: 207.37, enabledP95Ms: 87.083 },
      { disabledP95Ms: 198.571, enabledP95Ms: 38.955 },
    ]);
    const confirmation = summarizeAdministrationIsolationSeries([
      { disabledP95Ms: 36.251, enabledP95Ms: 169.3 },
      { disabledP95Ms: 31.112, enabledP95Ms: 31.574 },
      { disabledP95Ms: 30.121, enabledP95Ms: 35.443 },
      { disabledP95Ms: 47.943, enabledP95Ms: 32.82 },
      { disabledP95Ms: 31.021, enabledP95Ms: 35.244 },
    ]);

    expect(initial.requiresConfirmation).toBe(true);
    expect(confirmation.requiresConfirmation).toBe(true);
    expect(hasSustainedAdministrationRegression(initial, confirmation)).toBe(
      false,
    );
  });

  it('rejects an administration regression in every confirmation round', () => {
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
