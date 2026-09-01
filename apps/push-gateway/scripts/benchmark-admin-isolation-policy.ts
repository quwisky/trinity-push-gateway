export const ADMIN_ISOLATION_REGRESSION_PERCENT = 5;
export const ADMIN_ISOLATION_ROUNDS_PER_SERIES = 5;

export type AdministrationIsolationRound = Readonly<{
  disabledP95Ms: number;
  enabledP95Ms: number;
}>;

export type AdministrationIsolationSummary = Readonly<{
  disabledMedianP95Ms: number;
  enabledMedianP95Ms: number;
  medianDeltaPercent: number;
  regressedRounds: number;
  requiresConfirmation: boolean;
  rounds: readonly AdministrationIsolationRound[];
}>;

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered[middle] ?? Number.POSITIVE_INFINITY;
}

function deltaPercent(disabledP95Ms: number, enabledP95Ms: number): number {
  return ((enabledP95Ms - disabledP95Ms) / disabledP95Ms) * 100;
}

export function summarizeAdministrationIsolationSeries(
  rounds: readonly AdministrationIsolationRound[],
): AdministrationIsolationSummary {
  if (rounds.length !== ADMIN_ISOLATION_ROUNDS_PER_SERIES) {
    throw new Error(
      `Administration isolation requires ${String(ADMIN_ISOLATION_ROUNDS_PER_SERIES)} rounds per series.`,
    );
  }
  if (
    rounds.some(
      ({ disabledP95Ms, enabledP95Ms }) =>
        !Number.isFinite(disabledP95Ms) ||
        disabledP95Ms <= 0 ||
        !Number.isFinite(enabledP95Ms) ||
        enabledP95Ms <= 0,
    )
  ) {
    throw new Error(
      'Administration isolation rounds require positive finite p95 values.',
    );
  }

  const disabledMedianP95Ms = median(
    rounds.map(({ disabledP95Ms }) => disabledP95Ms),
  );
  const enabledMedianP95Ms = median(
    rounds.map(({ enabledP95Ms }) => enabledP95Ms),
  );
  const medianDeltaPercent = deltaPercent(
    disabledMedianP95Ms,
    enabledMedianP95Ms,
  );
  const regressedRounds = rounds.filter(
    ({ disabledP95Ms, enabledP95Ms }) =>
      deltaPercent(disabledP95Ms, enabledP95Ms) >
      ADMIN_ISOLATION_REGRESSION_PERCENT,
  ).length;
  const requiresConfirmation =
    medianDeltaPercent > ADMIN_ISOLATION_REGRESSION_PERCENT &&
    regressedRounds >= Math.ceil(rounds.length * 0.6);

  return Object.freeze({
    disabledMedianP95Ms,
    enabledMedianP95Ms,
    medianDeltaPercent,
    regressedRounds,
    requiresConfirmation,
    rounds: Object.freeze([...rounds]),
  });
}

export function hasSustainedAdministrationRegression(
  first: AdministrationIsolationSummary,
  confirmation: AdministrationIsolationSummary,
): boolean {
  return first.requiresConfirmation && confirmation.requiresConfirmation;
}
