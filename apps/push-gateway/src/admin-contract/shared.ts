import * as z from 'zod/mini';

export const ADMIN_CONTRACT_REGISTRY = z.registry<Record<string, unknown>>();

export const UTC_TIMESTAMP_SCHEMA = z.iso
  .datetime()
  .register(ADMIN_CONTRACT_REGISTRY, {
    description: 'RFC 3339 timestamp normalized to UTC and ending in `Z`.',
    id: 'UtcTimestamp',
  });

export const OPAQUE_ID_SCHEMA = z
  .string()
  .check(z.regex(/^[A-Za-z0-9_-]{16,128}$/u))
  .register(ADMIN_CONTRACT_REGISTRY, {
    description: 'Opaque identifier with no client-meaningful structure.',
    id: 'OpaqueId',
  });

export const POSITIVE_SAFE_INTEGER_SCHEMA = z
  .number()
  .check(z.int(), z.gte(1), z.lte(Number.MAX_SAFE_INTEGER))
  .register(ADMIN_CONTRACT_REGISTRY, {
    description: 'Positive JSON safe integer.',
    id: 'PositiveSafeInteger',
  });
