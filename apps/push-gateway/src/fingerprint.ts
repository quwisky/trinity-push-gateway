import type { DeliveryIdentity } from './ports';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export async function fingerprintFor(
  identity: DeliveryIdentity,
  fingerprintKey: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(fingerprintKey),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(
      JSON.stringify([
        identity.appId,
        identity.accountRoute,
        identity.eventId,
        identity.pushKey,
      ]),
    ),
  );
  return base64Url(new Uint8Array(signature));
}
