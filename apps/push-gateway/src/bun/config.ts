import { readFileSync } from 'node:fs';

import { runtimeConfig, type ConfigurationEnvironment } from '../config';
import {
  trustedProxyConfigurationValid,
  type ClientIpHeader,
} from './client-address';

export type BunConfiguration = {
  readonly cleanupIntervalSeconds: number;
  readonly clientIpHeader: ClientIpHeader;
  readonly databasePath: string;
  readonly environment: ConfigurationEnvironment;
  readonly host: string;
  readonly maxSourceKeys: number;
  readonly port: number;
  readonly sourceLimit: number;
  readonly sourcePeriodSeconds: number;
  readonly trustedProxyCidrs: readonly string[];
};

type Environment = Readonly<Record<string, string | undefined>>;

function required(environment: Environment, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function credential(environment: Environment, name: string): string {
  const direct = environment[name];
  const fileName = `${name}_FILE`;
  const file = environment[fileName];
  if (direct !== undefined && file !== undefined) {
    throw new Error(`${name} and ${fileName} cannot both be set.`);
  }
  if (file !== undefined) {
    if (file.length === 0) {
      throw new Error(`${fileName} cannot be empty.`);
    }
    const value = readFileSync(file, 'utf8').trimEnd();
    if (value.length === 0) {
      throw new Error(`${fileName} contains an empty value.`);
    }
    return value;
  }
  return required(environment, name);
}

function positiveInteger(
  environment: Environment,
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const raw = environment[name] ?? String(fallback);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(
      `${name} must be a positive integer no greater than ${String(maximum)}.`,
    );
  }
  return parsed;
}

export function loadBunConfiguration(
  environment: Environment,
): BunConfiguration {
  const runtimeEnvironment: ConfigurationEnvironment = {
    TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: required(
      environment,
      'TRINITY_PUSH_GATEWAY_ANDROID_APP_ID',
    ),
    TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL: credential(
      environment,
      'TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL',
    ),
    TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY: credential(
      environment,
      'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY',
    ),
    TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID: credential(
      environment,
      'TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID',
    ),
    TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: credential(
      environment,
      'TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY',
    ),
    TRINITY_PUSH_GATEWAY_IOS_APP_ID: required(
      environment,
      'TRINITY_PUSH_GATEWAY_IOS_APP_ID',
    ),
    TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES',
        65_536,
      ),
    ),
    TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS',
        20_000,
      ),
    ),
    TRINITY_PUSH_GATEWAY_MAX_DEVICES: String(
      positiveInteger(environment, 'TRINITY_PUSH_GATEWAY_MAX_DEVICES', 49, 49),
    ),
    TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS',
        120,
      ),
    ),
    TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS',
        30,
      ),
    ),
    TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS',
        86_400,
      ),
    ),
    TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS',
        10,
      ),
    ),
  };
  if (runtimeConfig(runtimeEnvironment) === undefined) {
    throw new Error('Gateway runtime configuration is invalid.');
  }

  const clientIpHeader =
    environment.TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER ?? 'x-forwarded-for';
  if (
    clientIpHeader !== 'x-forwarded-for' &&
    clientIpHeader !== 'cf-connecting-ip'
  ) {
    throw new Error(
      'TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER must be x-forwarded-for or cf-connecting-ip.',
    );
  }
  const trustedProxyCidrs = (
    environment.TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS ?? ''
  )
    .split(',')
    .map((cidr) => cidr.trim())
    .filter((cidr) => cidr.length > 0);
  if (!trustedProxyConfigurationValid(trustedProxyCidrs)) {
    throw new Error(
      'TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS contains an invalid network.',
    );
  }

  return {
    cleanupIntervalSeconds: positiveInteger(
      environment,
      'TRINITY_PUSH_GATEWAY_CLEANUP_INTERVAL_SECONDS',
      86_400,
    ),
    clientIpHeader,
    databasePath:
      environment.TRINITY_PUSH_GATEWAY_DATABASE_PATH ?? '/data/gateway.sqlite',
    environment: runtimeEnvironment,
    host: environment.TRINITY_PUSH_GATEWAY_HOST ?? '0.0.0.0',
    maxSourceKeys: positiveInteger(
      environment,
      'TRINITY_PUSH_GATEWAY_MAX_SOURCE_KEYS',
      10_000,
    ),
    port: positiveInteger(
      environment,
      'TRINITY_PUSH_GATEWAY_PORT',
      3000,
      65_535,
    ),
    sourceLimit: positiveInteger(
      environment,
      'TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMIT',
      300,
    ),
    sourcePeriodSeconds: positiveInteger(
      environment,
      'TRINITY_PUSH_GATEWAY_SOURCE_RATE_PERIOD_SECONDS',
      10,
    ),
    trustedProxyCidrs,
  };
}
