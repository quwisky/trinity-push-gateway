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

import {
  ADMIN_PROBLEM_CODES,
  AUDIT_QUERY_POLICY,
  METRICS_QUERY_POLICY,
} from '../../api/admin-contract.generated';

const isBoundedRange = (
  from: string,
  to: string,
  maximumMilliseconds: number,
): boolean => {
  const fromTime = new Date(from).getTime();
  const toTime = new Date(to).getTime();
  return (
    Number.isFinite(fromTime) &&
    Number.isFinite(toTime) &&
    fromTime < toTime &&
    toTime - fromTime <= maximumMilliseconds
  );
};

export const apiProblemSchema = object({
  code: optional(zodEnum(ADMIN_PROBLEM_CODES)),
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
  interval: zodEnum(METRICS_QUERY_POLICY.intervals),
}).check(
  refine(
    ({ from, to }) =>
      isBoundedRange(
        from,
        to,
        METRICS_QUERY_POLICY.maximumRangeSeconds * 1_000,
      ),
    {
      message: `Choose a non-empty range no longer than ${String(METRICS_QUERY_POLICY.maximumRangeDays)} days.`,
      path: ['to'],
    },
  ),
);

export const auditFilterSchema = object({
  from: string().check(minLength(1)),
  to: string().check(minLength(1)),
  kind: zodEnum(['all', ...AUDIT_QUERY_POLICY.kinds]),
  outcome: zodEnum(['all', ...AUDIT_QUERY_POLICY.outcomes]),
}).check(
  refine(
    ({ from, to }) =>
      isBoundedRange(from, to, AUDIT_QUERY_POLICY.maximumRangeSeconds * 1_000),
    {
      message: `Choose a non-empty audit range no longer than ${String(AUDIT_QUERY_POLICY.maximumRangeDays)} days.`,
      path: ['to'],
    },
  ),
);
