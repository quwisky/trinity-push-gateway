export function createMockOidcAdapter() {
  return Object.freeze({
    clientId: 'deterministic-client',
    composeFile: '/deterministic/mock-oidc-compose.yml',
    createProviderSecrets: (secretFactory) => ({
      clientSecret: secretFactory(36),
      providerSecret: secretFactory(24),
    }),
    displayName: 'Deterministic OIDC mock',
    id: 'mock-oidc',
    issuer: 'http://127.0.0.1:9191',
    outageServices: Object.freeze(['provider']),
    async authenticate({ navigate }) {
      await navigate();
    },
    providerEnvironment: (secrets) => ({
      MOCK_CLIENT_SECRET: secrets.clientSecret,
      MOCK_PROVIDER_SECRET: secrets.providerSecret,
    }),
    providerOrigin: 'http://127.0.0.1:9191',
    async provision() {
      return {
        allowed: Object.freeze({ subject: 'allowed-operator' }),
        denied: Object.freeze({ subject: 'denied-operator' }),
      };
    },
    requiredGroup: 'gateway-operators',
    scopes: 'openid groups',
    tokenEndpointAuthMethod: 'client_secret_basic',
  });
}
