import * as z from 'zod/mini';

export const OPERATOR_SESSION_CONTRACT_REGISTRY =
  z.registry<Record<string, unknown>>();

const UTC_TIMESTAMP_SCHEMA = z.iso
  .datetime()
  .register(OPERATOR_SESSION_CONTRACT_REGISTRY, {
    description: 'RFC 3339 timestamp normalized to UTC and ending in `Z`.',
    id: 'UtcTimestamp',
  });

const OPAQUE_ID_SCHEMA = z
  .string()
  .check(z.regex(/^[A-Za-z0-9_-]{16,128}$/u))
  .register(OPERATOR_SESSION_CONTRACT_REGISTRY, {
    description: 'Opaque identifier with no client-meaningful structure.',
    id: 'OpaqueId',
  });

const OPERATOR_IDENTITY_SCHEMA = z
  .strictObject({
    issuer: z
      .url()
      .check(z.maxLength(2048))
      .register(OPERATOR_SESSION_CONTRACT_REGISTRY, {
        description:
          'Exact identity-provider issuer for this Operator Identity.',
      }),
    subject: z
      .string()
      .check(z.minLength(1), z.maxLength(512))
      .register(OPERATOR_SESSION_CONTRACT_REGISTRY, {
        description: 'Provider-local subject for this Operator Identity.',
      }),
    displayName: z.optional(
      z
        .string()
        .check(z.minLength(1), z.maxLength(256))
        .register(OPERATOR_SESSION_CONTRACT_REGISTRY, {
          description:
            'Optional display label copied from the current accepted identity claims.',
        }),
    ),
    email: z.optional(
      z
        .email()
        .check(z.minLength(3), z.maxLength(320))
        .register(OPERATOR_SESSION_CONTRACT_REGISTRY, {
          description:
            'Optional display email copied from the current accepted identity claims.',
        }),
    ),
  })
  .register(OPERATOR_SESSION_CONTRACT_REGISTRY, {
    description:
      'Privacy-safe Operator Identity attributes accepted for display by the Push Gateway UI.',
    id: 'OperatorIdentity',
  });

export const OPERATOR_SESSION_RESPONSE_SCHEMA = z
  .strictObject({
    id: OPAQUE_ID_SCHEMA,
    operator: OPERATOR_IDENTITY_SCHEMA,
    createdAt: UTC_TIMESTAMP_SCHEMA,
    lastSeenAt: UTC_TIMESTAMP_SCHEMA,
    idleExpiresAt: UTC_TIMESTAMP_SCHEMA,
    absoluteExpiresAt: UTC_TIMESTAMP_SCHEMA,
    current: z.boolean().register(OPERATOR_SESSION_CONTRACT_REGISTRY, {
      description: 'Whether this is the session authenticating the request.',
    }),
  })
  .register(OPERATOR_SESSION_CONTRACT_REGISTRY, {
    description:
      'The authenticated Operator Identity and bounded current Operator Session.',
    id: 'OperatorSession',
  });

export type OperatorSessionResponse = z.infer<
  typeof OPERATOR_SESSION_RESPONSE_SCHEMA
>;
