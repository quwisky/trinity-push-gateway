# syntax=docker/dockerfile:1.7

FROM node:26.8.1-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e AS dependencies
WORKDIR /app
ENV HUSKY=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM oven/bun:1.4.0-slim@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
RUN bun build src/bun/main.ts --target bun --outdir dist/bun

FROM oven/bun:1.4.0-slim@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 AS runtime
LABEL org.opencontainers.image.description="Matrix-to-FCM push gateway" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/quwisky/trinity-push-gateway"
WORKDIR /app
RUN install -d -o bun -g bun /data /app/migrations
COPY --from=build --chown=bun:bun /app/dist/bun/main.js /app/main.js
COPY --chown=bun:bun migrations /app/migrations
ENV DATABASE_PATH=/data/gateway.sqlite \
    HOST=0.0.0.0 \
    MIGRATIONS_PATH=/app/migrations \
    PORT=3000
USER bun
VOLUME ["/data"]
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD ["bun", "--no-env-file", "-e", "const r=await fetch(`http://127.0.0.1:${process.env.PORT??3000}/health`);if(!r.ok)process.exit(1)"]
ENTRYPOINT ["bun", "--no-env-file", "/app/main.js"]
CMD ["serve"]
