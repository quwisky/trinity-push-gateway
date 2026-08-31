const [issuer] = process.argv.slice(2);
if (!issuer) throw new Error('OIDC issuer is required.');

const discoveryUrl = `${issuer.replace(/\/$/u, '')}/.well-known/openid-configuration`;
let lastError;
for (let attempt = 0; attempt < 180; attempt += 1) {
  try {
    const response = await fetch(discoveryUrl, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`discovery returned ${response.status}`);
    const document = await response.json();
    if (document.issuer !== issuer) {
      throw new Error(`issuer mismatch: ${String(document.issuer)}`);
    }
    for (const field of [
      'authorization_endpoint',
      'end_session_endpoint',
      'jwks_uri',
      'token_endpoint',
    ]) {
      const endpoint = document[field];
      if (
        typeof endpoint !== 'string' ||
        new URL(endpoint).origin !== new URL(issuer).origin
      ) {
        throw new Error(`invalid ${field}`);
      }
    }
    console.info(`OIDC discovery ready for ${issuer}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}
throw new Error(`OIDC provider did not become ready: ${String(lastError)}`);
