import type { GetMetricsParams } from '../../api/generated/admin-api.schemas';

export const includesCurrentUtcBucket = (
  parameters: GetMetricsParams,
  now = Date.now(),
): boolean => {
  const current = new Date(now);
  const bucketStart =
    parameters.interval === 'day'
      ? Date.UTC(
          current.getUTCFullYear(),
          current.getUTCMonth(),
          current.getUTCDate(),
        )
      : Date.UTC(
          current.getUTCFullYear(),
          current.getUTCMonth(),
          current.getUTCDate(),
          current.getUTCHours(),
        );
  const bucketEnd =
    bucketStart + (parameters.interval === 'day' ? 86_400_000 : 3_600_000);
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
