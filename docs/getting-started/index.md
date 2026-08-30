# Choose a deployment

Trinity Push Gateway is operated for one pair of Android and iOS application
IDs. Before deploying it, create a Firebase project, register both applications,
enable the FCM HTTP v1 API, and create a dedicated service account that may send
messages for that project.

## Cloudflare Workers

Choose Cloudflare when you want the smallest operational footprint. The Worker
uses D1 for delivery coordination, a Cloudflare rate-limit binding, and a daily
cleanup trigger. The default limits are designed to stay within a small
single-tenant deployment envelope.

[Deploy on Cloudflare](/deployment/cloudflare/)

## Docker and Bun

Choose self-hosting when you need to own the runtime and data location. The
supported topology is one Linux container, one SQLite database on local durable
storage, and an external TLS reverse proxy.

[Self-host with Docker](/deployment/self-hosting/)

## Shared requirements

- A stable HTTPS hostname reachable by Matrix homeservers.
- Firebase credentials owned and rotated by the gateway operator.
- Distinct Android and iOS app IDs.
- A separately generated fingerprint key of at least 32 bytes.
- A compatible mobile client configured in a separate client-development task.

After deployment, require `/health` to return an `ok` status before registering
the gateway URL with a Matrix pusher.
