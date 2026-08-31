import { catalogDefaults } from './types';

export const COMPOSE_CONFIGURATION_DEFINITIONS = Object.freeze([
  {
    name: 'TRINITY_PUSH_GATEWAY_HOST_PORT',
    description: 'Loopback host port published by Docker Compose.',
    defaultValue: '3000',
    required: false,
    runtimes: ['compose'],
    secret: false,
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_VERSION',
    description: 'Container tag or digest selected by Docker Compose.',
    defaultValue: 'latest',
    required: false,
    runtimes: ['compose'],
    secret: false,
    constraint: 'Pin an immutable vX.Y.Z tag or digest in production.',
  },
] as const);

export const COMPOSE_CONFIGURATION_DEFAULTS = catalogDefaults(
  COMPOSE_CONFIGURATION_DEFINITIONS,
);
