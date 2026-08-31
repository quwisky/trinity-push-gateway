# syntax=docker/dockerfile:1.7

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS dependencies
WORKDIR /app
ENV HUSKY=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN corepack enable && pnpm install --frozen-lockfile

FROM oven/bun:1.4.0-slim@sha256:e0ee68d16ccb9927bf02aa7dd8fd4bf3369ee6d46da04faa72b05ce8bfd135f6 AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY apps/push-gateway/src ./apps/push-gateway/src
RUN bun build apps/push-gateway/src/bun/main.ts apps/push-gateway/src/bun/metrics-writer.worker.ts --target bun --outdir dist/apps/push-gateway/bun

FROM oven/bun:1.4.0-slim@sha256:e0ee68d16ccb9927bf02aa7dd8fd4bf3369ee6d46da04faa72b05ce8bfd135f6 AS runtime
LABEL org.opencontainers.image.description="Matrix-to-FCM push gateway" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/quwisky/trinity-push-gateway"
WORKDIR /app
RUN install -d -o bun -g bun /data /app/migrations
COPY --from=build --chown=bun:bun /app/dist/apps/push-gateway/bun/ /app/
COPY --chown=bun:bun apps/push-gateway/migrations/*.sql /app/migrations/
ENV TRINITY_PUSH_GATEWAY_DATABASE_PATH=/data/gateway.sqlite \
    TRINITY_PUSH_GATEWAY_HOST=0.0.0.0 \
    TRINITY_PUSH_GATEWAY_MIGRATIONS_PATH=/app/migrations \
    TRINITY_PUSH_GATEWAY_PORT=3000
USER bun
VOLUME ["/data"]
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD ["bun", "--no-env-file", "-e", "const r=await fetch(`http://127.0.0.1:${process.env.TRINITY_PUSH_GATEWAY_PORT??3000}/health`);if(!r.ok)process.exit(1)"]
ENTRYPOINT ["bun", "--no-env-file", "/app/main.js"]
CMD ["serve"]
