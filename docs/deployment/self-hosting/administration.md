# Enable the administration UI

The administration UI is an opt-in feature of the single self-hosted Bun
container. It is not available on Cloudflare and it does not add a second
service, listener, or writable volume. The Angular application, same-origin
operator API, and OIDC routes are served below `/admin/`; delivery continues at
the existing Matrix endpoint.

## Before enabling

You need:

- a stable HTTPS hostname for the gateway;
- a confidential OIDC client in Pocket ID or Authentik;
- one identity-provider group whose members may operate the gateway;
- a random OIDC client secret and an independent random session secret;
- a reverse proxy that owns TLS, HSTS, and response compression.

Do not expose container port 3000 to a public interface. The supplied Compose
file keeps its loopback binding when the administration override is applied.

## Configure the Compose override

Copy `.env.self-host-admin.example` to an ignored `.env.self-host-admin`. Create
these additional files beside the four delivery secret files:

- `secrets/admin_oidc_client_secret`, containing the provider client secret;
- `secrets/admin_session_secret`, containing at least 32 random bytes.

Keep both files readable only by the deployment operator. Then start the base
service and administration override together:

```sh
docker compose \
  --env-file .env.self-host \
  --env-file .env.self-host-admin \
  --file compose.yml \
  --file compose.admin.yml \
  up --detach
```

The override sets the administration database to `/data/admin.sqlite` and its
verified gateway-backup directory to `/data/backups`. On first successful
enablement, the runtime validates separation from `gateway.sqlite`, applies the
reviewed administration migrations, and loads the production browser assets.
It does not alter the delivery schema.

Require all three checks:

```sh
curl --fail --show-error https://push.example.com/health
curl --fail --show-error https://push.example.com/admin/
curl --fail --show-error https://push.example.com/admin/sign-in
```

If administration configuration, assets, OIDC, migrations, or `admin.sqlite`
fail, `/admin/*` fails closed with a generic response. `/health` and Matrix
notification delivery remain independent. Remove the override or set
`TRINITY_PUSH_GATEWAY_ADMIN_ENABLED=false` to return to delivery-only mode;
disabled mode ignores every other administration setting and requires no new
secret.

## Exact URLs

For an origin of `https://push.example.com`, register these exact values:

| Purpose                | URL                                            |
| ---------------------- | ---------------------------------------------- |
| Public origin          | `https://push.example.com`                     |
| Authorization callback | `https://push.example.com/admin/auth/callback` |
| Post-logout return     | `https://push.example.com/admin/`              |

The public origin is an origin, not a path: no credentials, query, fragment, or
trailing slash. The callback is matched exactly. Except for explicit loopback
development, both issuer and public origin must use HTTPS.

## Pocket ID

Create a confidential OIDC client in Pocket ID with Authorization Code, PKCE,
the exact callback and logout URLs above, and the allowed operator group. A new
group-restricted Pocket ID client permits no users until its allowed group is
assigned.

Use:

```dotenv
TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER=https://id.example.com
TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES=openid profile email groups
TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM=groups
TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP=push-gateway-operators
TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD=client_secret_basic
```

Pocket ID emits group names only when the `groups` scope is requested. Match the
required group exactly, including case. Test with one member and one non-member
before treating the deployment as ready.

## Authentik

Create an OAuth2/OpenID provider and application with:

- confidential client type, Authorization Code, and PKCE;
- strict callback and logout URLs;
- the built-in `openid`, `profile`, and `email` scope mappings;
- groups included in the ID token; the default profile mapping supplies the
  group-name array;
- per-provider issuer mode.

If the application slug is `trinity-push-gateway`, use its complete issuer:

```dotenv
TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER=https://auth.example.com/application/o/trinity-push-gateway/
TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES=openid profile email
TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM=groups
TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP=push-gateway-operators
TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD=client_secret_post
```

Do not use the Authentik base URL as the issuer. Confirm the issuer returned by
its discovery document exactly matches the configured value, then test a group
member and non-member.

## Reverse proxy, TLS, HSTS, and compression

The image deliberately does not bundle a reverse proxy or certificates. A
minimal Caddy deployment is:

```txt
push.example.com {
  encode zstd gzip
  header Strict-Transport-Security "max-age=31536000; includeSubDomains"
  reverse_proxy 127.0.0.1:3000
}
```

Enable `includeSubDomains` only when every subdomain is permanently HTTPS. The
proxy must preserve the original host and scheme so browser redirects resolve
to the configured public origin. It must replace, not append, the client-address
header, and its direct network must appear in
`TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS` before forwarded addresses are
trusted.

After deployment, verify the public HTTPS response carries HSTS and compression
at the proxy, while the gateway supplies its CSP, anti-framing, no-sniff,
referrer, permissions, cross-origin, and cache policies. Do not weaken the CSP
to add remote fonts, scripts, analytics, or CDNs; the UI is intentionally
self-contained.

## Credential rotation

Rotate either secret by replacing its Docker secret file and recreating the
container. Rotating the session secret immediately invalidates every local
Operator Session. Rotating the OIDC client secret blocks new login until the
provider and gateway agree, but it does not expand an existing session's
lifetime. There is no live reload and no local break-glass login.

Continue with [administration operations and recovery](/operations/administration)
and [backup scope](/operations/backup-and-restore).
