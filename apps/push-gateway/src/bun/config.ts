import { readFileSync } from 'node:fs';
import path from 'node:path';

import { runtimeConfig, type ConfigurationEnvironment } from '../config';
import {
  BUN_CONFIGURATION_DEFAULTS,
  SHARED_CONFIGURATION_DEFAULTS,
} from '../configuration-defaults';
import {
  trustedProxyConfigurationValid,
  type ClientIpHeader,
} from './client-address';
import {
  loadAdminConfiguration,
  type AdminConfigurationState,
} from './admin/config';

export type CredentialSource = 'env' | 'file';

export type GatewayCredentialSources = Readonly<{
  firebaseClientEmail: CredentialSource;
  firebasePrivateKey: CredentialSource;
  firebaseProjectId: CredentialSource;
  fingerprintKey: CredentialSource;
}>;

export type BunConfiguration = {
  readonly administration: AdminConfigurationState;
  readonly cleanupIntervalSeconds: number;
  readonly clientIpHeader: ClientIpHeader;
  readonly credentialSources: GatewayCredentialSources;
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

function credentialSource(
  environment: Environment,
  name: string,
): CredentialSource {
  return environment[`${name}_FILE`] === undefined ? 'env' : 'file';
}

function positiveInteger(
  environment: Environment,
  name: string,
  fallback: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const raw = environment[name] ?? fallback;
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
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES,
      ),
    ),
    TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS',
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS,
      ),
    ),
    TRINITY_PUSH_GATEWAY_MAX_DEVICES: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_MAX_DEVICES',
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_MAX_DEVICES,
        49,
      ),
    ),
    TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS',
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS,
      ),
    ),
    TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS',
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS,
      ),
    ),
    TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS',
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS,
      ),
    ),
    TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS',
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS,
      ),
    ),
  };
  if (runtimeConfig(runtimeEnvironment) === undefined) {
    throw new Error('Gateway runtime configuration is invalid.');
  }

  const clientIpHeader =
    environment.TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER ??
    BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER;
  if (
    clientIpHeader !== 'x-forwarded-for' &&
    clientIpHeader !== 'cf-connecting-ip'
  ) {
    throw new Error(
      'TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER must be x-forwarded-for or cf-connecting-ip.',
    );
  }
  const trustedProxyCidrs = (
    environment.TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS ??
    BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS
  )
    .split(',')
    .map((cidr) => cidr.trim())
    .filter((cidr) => cidr.length > 0);
  if (!trustedProxyConfigurationValid(trustedProxyCidrs)) {
    throw new Error(
      'TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS contains an invalid network.',
    );
  }
  const databasePath =
    environment.TRINITY_PUSH_GATEWAY_DATABASE_PATH ??
    BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_DATABASE_PATH;
  const loadedAdministration = loadAdminConfiguration(environment);
  const administration =
    loadedAdministration.kind === 'enabled' &&
    path.resolve(loadedAdministration.configuration.databasePath) ===
      path.resolve(databasePath)
      ? ({ kind: 'invalid' } as const)
      : loadedAdministration;

  return {
    administration,
    cleanupIntervalSeconds: positiveInteger(
      environment,
      'TRINITY_PUSH_GATEWAY_CLEANUP_INTERVAL_SECONDS',
      BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_CLEANUP_INTERVAL_SECONDS,
    ),
    clientIpHeader,
    credentialSources: {
      firebaseClientEmail: credentialSource(
        environment,
        'TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL',
      ),
      firebasePrivateKey: credentialSource(
        environment,
        'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY',
      ),
      firebaseProjectId: credentialSource(
        environment,
        'TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID',
      ),
      fingerprintKey: credentialSource(
        environment,
        'TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY',
      ),
    },
    databasePath,
    environment: runtimeEnvironment,
    host:
      environment.TRINITY_PUSH_GATEWAY_HOST ??
      BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_HOST,
    maxSourceKeys: positiveInteger(
      environment,
      'TRINITY_PUSH_GATEWAY_MAX_SOURCE_KEYS',
      BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_MAX_SOURCE_KEYS,
    ),
    port: positiveInteger(
      environment,
      'TRINITY_PUSH_GATEWAY_PORT',
      BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_PORT,
      65_535,
    ),
    sourceLimit: positiveInteger(
      environment,
      'TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMIT',
      BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMIT,
    ),
    sourcePeriodSeconds: positiveInteger(
      environment,
      'TRINITY_PUSH_GATEWAY_SOURCE_RATE_PERIOD_SECONDS',
      BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_SOURCE_RATE_PERIOD_SECONDS,
    ),
    trustedProxyCidrs,
  };
}
