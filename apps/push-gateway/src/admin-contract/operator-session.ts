import * as z from 'zod/mini';

import {
  ADMIN_CONTRACT_REGISTRY,
  OPAQUE_ID_SCHEMA,
  UTC_TIMESTAMP_SCHEMA,
} from './shared';

export const OPERATOR_IDENTITY_SCHEMA = z
  .strictObject({
    issuer: z.url().check(z.maxLength(2048)).register(ADMIN_CONTRACT_REGISTRY, {
      description: 'Exact identity-provider issuer for this Operator Identity.',
    }),
    subject: z
      .string()
      .check(z.minLength(1), z.maxLength(512))
      .register(ADMIN_CONTRACT_REGISTRY, {
        description: 'Provider-local subject for this Operator Identity.',
      }),
    displayName: z.optional(
      z
        .string()
        .check(z.minLength(1), z.maxLength(256))
        .register(ADMIN_CONTRACT_REGISTRY, {
          description:
            'Optional display label copied from the current accepted identity claims.',
        }),
    ),
    email: z.optional(
      z
        .email()
        .check(z.minLength(3), z.maxLength(320))
        .register(ADMIN_CONTRACT_REGISTRY, {
          description:
            'Optional display email copied from the current accepted identity claims.',
        }),
    ),
  })
  .register(ADMIN_CONTRACT_REGISTRY, {
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
    current: z.boolean().register(ADMIN_CONTRACT_REGISTRY, {
      description: 'Whether this is the session authenticating the request.',
    }),
  })
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'The authenticated Operator Identity and bounded current Operator Session.',
    id: 'OperatorSession',
  });

export type OperatorSessionResponse = z.infer<
  typeof OPERATOR_SESSION_RESPONSE_SCHEMA
>;

export const OPERATOR_SESSION_LIST_RESPONSE_SCHEMA = z
  .strictObject({
    sessions: z
      .array(OPERATOR_SESSION_RESPONSE_SCHEMA)
      .check(z.maxLength(100))
      .register(ADMIN_CONTRACT_REGISTRY, {
        description:
          'Deployment-wide active sessions, ordered most recently seen first.',
      }),
  })
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'OperatorSessionList' });

export type OperatorSessionListResponse = z.infer<
  typeof OPERATOR_SESSION_LIST_RESPONSE_SCHEMA
>;

export { OPAQUE_ID_SCHEMA as OPERATOR_SESSION_ID_SCHEMA } from './shared';
