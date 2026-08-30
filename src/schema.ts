export const BUDGET_COLUMNS = ['utc_date', 'attempts'] as const;
export const DELIVERY_COLUMNS = [
  'fingerprint',
  'outcome',
  'lease_expires_at',
  'expires_at',
  'reason_category',
] as const;
export const DELIVERY_EXPIRY_INDEX = 'delivery_records_expiry_idx';
export const HEALTH_CHECK_DATE = '0000-health-check';
