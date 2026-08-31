import {
  boolean,
  enum as zodEnum,
  minLength,
  number,
  object,
  optional,
  refine,
  string,
} from 'zod/mini';

const millisecondsPerDay = 86_400_000;

const isBoundedRange = (
  from: string,
  to: string,
  maximumDays: number,
): boolean => {
  const fromTime = new Date(from).getTime();
  const toTime = new Date(to).getTime();
  return (
    Number.isFinite(fromTime) &&
    Number.isFinite(toTime) &&
    fromTime < toTime &&
    toTime - fromTime <= maximumDays * millisecondsPerDay
  );
};

export const apiProblemSchema = object({
  title: optional(string()),
  detail: optional(string()),
  status: optional(number()),
});

export const confirmationSchema = object({
  confirmed: boolean().check(
    refine((value) => value, {
      message: 'Confirm this Operator Action to continue.',
    }),
  ),
});

export const metricsFilterSchema = object({
  from: string().check(minLength(1)),
  to: string().check(minLength(1)),
  interval: zodEnum(['hour', 'day']),
}).check(
  refine(({ from, to }) => isBoundedRange(from, to, 30), {
    message: 'Choose a non-empty range no longer than 30 days.',
    path: ['to'],
  }),
);

export const auditFilterSchema = object({
  from: string().check(minLength(1)),
  to: string().check(minLength(1)),
  kind: zodEnum([
    'all',
    'login',
    'logout',
    'session_expired',
    'session_revoked',
    'session_cap_eviction',
    'policy_rejected',
    'session_purge',
    'firebase_validation',
    'cleanup',
    'backup',
  ]),
  outcome: zodEnum([
    'all',
    'succeeded',
    'failed',
    'started',
    'outcome_unknown',
  ]),
}).check(
  refine(({ from, to }) => isBoundedRange(from, to, 90), {
    message: 'Choose a non-empty audit range no longer than 90 days.',
    path: ['to'],
  }),
);
