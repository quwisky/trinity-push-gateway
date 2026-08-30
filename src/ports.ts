export type DeliveryIdentity = {
  readonly accountRoute: string;
  readonly appId: string;
  readonly eventId: string;
  readonly pushKey: string;
};

export type DeliveryClaim =
  | { readonly fingerprint: string; readonly kind: 'acquired' }
  | { readonly kind: 'delivered' }
  | { readonly kind: 'pending'; readonly retryAfterSeconds: number }
  | { readonly kind: 'rejected' };

export type SourceLimit = {
  readonly retryAfterSeconds: number;
  readonly success: boolean;
};

export type SourceLimiter = {
  readonly limit: (key: string) => Promise<SourceLimit>;
};

export type GatewayStore = {
  readonly claimDelivery: (
    identity: DeliveryIdentity,
    fingerprintKey: string,
    nowSeconds: number,
    leaseSeconds: number,
  ) => Promise<DeliveryClaim>;
  readonly cleanup: (nowSeconds: number, utcDate: string) => Promise<void>;
  readonly completeDelivery: (
    fingerprint: string,
    outcome: 'delivered' | 'rejected',
    reasonCategory: string | undefined,
    expiresAt: number,
  ) => Promise<void>;
  readonly ready: () => Promise<boolean>;
  readonly releaseDelivery: (fingerprint: string) => Promise<void>;
  readonly reserveDailyAttempts: (
    utcDate: string,
    requestedAttempts: number,
    maximumAttempts: number,
  ) => Promise<boolean>;
};
