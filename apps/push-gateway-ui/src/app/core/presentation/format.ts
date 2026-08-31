import type { OperatorIdentity } from '../../api/generated/admin-api.schemas';

const numberFormatter = new Intl.NumberFormat();

export const formatCount = (value: number): string =>
  numberFormatter.format(value);

export const formatBytes = (value: number): string => {
  if (value < 1024) {
    return `${formatCount(value)} B`;
  }
  const units = ['KiB', 'MiB', 'GiB', 'TiB'] as const;
  let scaled = value / 1024;
  let unit: (typeof units)[number] = units[0];
  for (const candidate of units.slice(1)) {
    if (scaled < 1024) {
      break;
    }
    scaled /= 1024;
    unit = candidate;
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(scaled)} ${unit}`;
};

export const formatDuration = (seconds: number): string => {
  if (seconds < 60) {
    return `${formatCount(seconds)} sec`;
  }
  if (seconds < 3600) {
    return `${formatCount(Math.floor(seconds / 60))} min`;
  }
  if (seconds < 86_400) {
    return `${formatCount(Math.floor(seconds / 3600))} hr`;
  }
  return `${formatCount(Math.floor(seconds / 86_400))} days`;
};

export const humanizeToken = (value: string): string =>
  value
    .replace(/_/gu, ' ')
    .replace(/^./u, (initial: string) => initial.toUpperCase());

export const operatorLabel = (identity: OperatorIdentity | null): string =>
  identity?.displayName ??
  identity?.email ??
  identity?.subject ??
  'System or CLI';
