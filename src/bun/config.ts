import { readFileSync } from 'node:fs';

import { runtimeConfig } from '../config';
import type { ConfigurationEnvironment } from '../env';
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
    ANDROID_APP_ID: required(environment, 'ANDROID_APP_ID'),
    FCM_CLIENT_EMAIL: credential(environment, 'FCM_CLIENT_EMAIL'),
    FCM_PRIVATE_KEY: credential(environment, 'FCM_PRIVATE_KEY'),
    FCM_PROJECT_ID: credential(environment, 'FCM_PROJECT_ID'),
    FINGERPRINT_KEY: credential(environment, 'FINGERPRINT_KEY'),
    IOS_APP_ID: required(environment, 'IOS_APP_ID'),
    MAX_BODY_BYTES: String(
      positiveInteger(environment, 'MAX_BODY_BYTES', 65_536),
    ),
    MAX_DAILY_ATTEMPTS: String(
      positiveInteger(environment, 'MAX_DAILY_ATTEMPTS', 20_000),
    ),
    MAX_DEVICES: String(positiveInteger(environment, 'MAX_DEVICES', 49, 49)),
    PENDING_LEASE_SECONDS: String(
      positiveInteger(environment, 'PENDING_LEASE_SECONDS', 120),
    ),
    REQUEST_DEADLINE_SECONDS: String(
      positiveInteger(environment, 'REQUEST_DEADLINE_SECONDS', 30),
    ),
    TERMINAL_RETENTION_SECONDS: String(
      positiveInteger(environment, 'TERMINAL_RETENTION_SECONDS', 86_400),
    ),
    UPSTREAM_TIMEOUT_SECONDS: String(
      positiveInteger(environment, 'UPSTREAM_TIMEOUT_SECONDS', 10),
    ),
  };
  if (runtimeConfig(runtimeEnvironment) === undefined) {
    throw new Error('Gateway runtime configuration is invalid.');
  }

  const clientIpHeader = environment.CLIENT_IP_HEADER ?? 'x-forwarded-for';
  if (
    clientIpHeader !== 'x-forwarded-for' &&
    clientIpHeader !== 'cf-connecting-ip'
  ) {
    throw new Error(
      'CLIENT_IP_HEADER must be x-forwarded-for or cf-connecting-ip.',
    );
  }
  const trustedProxyCidrs = (environment.TRUSTED_PROXY_CIDRS ?? '')
    .split(',')
    .map((cidr) => cidr.trim())
    .filter((cidr) => cidr.length > 0);
  if (!trustedProxyConfigurationValid(trustedProxyCidrs)) {
    throw new Error('TRUSTED_PROXY_CIDRS contains an invalid network.');
  }

  return {
    cleanupIntervalSeconds: positiveInteger(
      environment,
      'CLEANUP_INTERVAL_SECONDS',
      86_400,
    ),
    clientIpHeader,
    databasePath: environment.DATABASE_PATH ?? '/data/gateway.sqlite',
    environment: runtimeEnvironment,
    host: environment.HOST ?? '0.0.0.0',
    maxSourceKeys: positiveInteger(environment, 'MAX_SOURCE_KEYS', 10_000),
    port: positiveInteger(environment, 'PORT', 3000, 65_535),
    sourceLimit: positiveInteger(environment, 'SOURCE_RATE_LIMIT', 300),
    sourcePeriodSeconds: positiveInteger(
      environment,
      'SOURCE_RATE_PERIOD_SECONDS',
      10,
    ),
    trustedProxyCidrs,
  };
}
