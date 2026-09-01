import { METRICS_QUERY_POLICY } from '../../api/admin-contract.generated';
import type { GetMetricsParams } from '../../api/generated/admin-api.schemas';

export const includesCurrentUtcBucket = (
  parameters: GetMetricsParams,
  now = Date.now(),
): boolean => {
  const interval = parameters.interval ?? METRICS_QUERY_POLICY.defaultInterval;
  const intervalMilliseconds =
    METRICS_QUERY_POLICY.intervalSeconds[interval] * 1_000;
  const bucketStart =
    Math.floor(now / intervalMilliseconds) * intervalMilliseconds;
  const bucketEnd = bucketStart + intervalMilliseconds;
  const from = parameters.from
    ? new Date(parameters.from).getTime()
    : Number.NEGATIVE_INFINITY;
  const to = parameters.to
    ? new Date(parameters.to).getTime()
    : Number.POSITIVE_INFINITY;

  return (
    !Number.isNaN(from) &&
    !Number.isNaN(to) &&
    from < bucketEnd &&
    to > bucketStart
  );
};
