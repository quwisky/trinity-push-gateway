import type { ServiceAccount } from '../../src/config';

function toPem(pkcs8: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  const lines = base64.match(/.{1,64}/g) ?? [];
  return [
    '-----BEGIN PRIVATE KEY-----',
    ...lines,
    '-----END PRIVATE KEY-----',
    '',
  ].join('\n');
}

/** Generates a throwaway service account whose key is created per call. */
export async function makeServiceAccount(): Promise<{
  serviceAccount: ServiceAccount;
  publicKey: CryptoKey;
}> {
  const { privateKey, publicKey } = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey(
    'pkcs8',
    privateKey,
  )) as ArrayBuffer;
  return {
    serviceAccount: {
      projectId: 'test-project',
      clientEmail: `sa-${crypto.randomUUID()}@test-project.iam.gserviceaccount.com`,
      privateKey: toPem(pkcs8),
    },
    publicKey,
  };
}
