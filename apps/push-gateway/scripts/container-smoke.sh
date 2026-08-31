#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

readonly IMAGE_NAME="${1:-trinity-push-gateway:check}"
readonly GATEWAY_ORIGIN='http://127.0.0.1:3000'
readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly WORKSPACE_ROOT="$(cd -- "$SCRIPT_DIRECTORY/../../.." && pwd -P)"
readonly TEMP_DIRECTORY="$(mktemp -d)"
readonly NAME_SUFFIX="${GITHUB_RUN_ID:-local}-$$"
readonly DISABLED_CONTAINER="gateway-disabled-$NAME_SUFFIX"
readonly INVALID_CONTAINER="gateway-invalid-$NAME_SUFFIX"
readonly ENABLED_CONTAINER="gateway-enabled-$NAME_SUFFIX"
readonly DISABLED_VOLUME="gateway-disabled-$NAME_SUFFIX"
readonly INVALID_VOLUME="gateway-invalid-$NAME_SUFFIX"
readonly ENABLED_VOLUME="gateway-enabled-$NAME_SUFFIX"

provider_pid=''

report_error() {
  local exit_code=$?
  printf 'Container smoke failed at line %s (exit %s).\n' "${BASH_LINENO[0]}" "$exit_code" >&2
  for container in "$DISABLED_CONTAINER" "$INVALID_CONTAINER" "$ENABLED_CONTAINER"; do
    docker logs "$container" 2>/dev/null || true
  done
  return "$exit_code"
}

cleanup() {
  if [[ -n "$provider_pid" ]]; then
    kill "$provider_pid" 2>/dev/null || true
    wait "$provider_pid" 2>/dev/null || true
  fi
  docker rm --force \
    "$DISABLED_CONTAINER" \
    "$INVALID_CONTAINER" \
    "$ENABLED_CONTAINER" >/dev/null 2>&1 || true
  docker volume rm \
    "$DISABLED_VOLUME" \
    "$INVALID_VOLUME" \
    "$ENABLED_VOLUME" >/dev/null 2>&1 || true
  rm -rf -- "$TEMP_DIRECTORY"
}

trap report_error ERR
trap cleanup EXIT INT TERM

for command in curl docker grep node sed tar; do
  command -v "$command" >/dev/null || {
    printf 'Required command is unavailable: %s\n' "$command" >&2
    exit 1
  }
done

container_status() {
  local expected=$1
  local method=$2
  local url=$3
  shift 3
  local actual
  actual="$(
    curl --silent --show-error \
      --output /dev/null \
      --request "$method" \
      --write-out '%{http_code}' \
      "$@" \
      "$url"
  )"
  if [[ "$actual" != "$expected" ]]; then
    printf 'Expected %s %s to return %s, received %s.\n' \
      "$method" "$url" "$expected" "$actual" >&2
    return 1
  fi
}

wait_for_status() {
  local expected=$1
  local url=$2
  for _attempt in $(seq 1 60); do
    if [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$url" || true)" == "$expected" ]]; then
      return 0
    fi
    sleep 1
  done
  printf 'Timed out waiting for %s from %s.\n' "$expected" "$url" >&2
  return 1
}

start_gateway() {
  local name=$1
  local volume=$2
  shift 2
  docker volume create "$volume" >/dev/null
  docker run --detach \
    --name "$name" \
    --network host \
    --cap-drop ALL \
    --init \
    --read-only \
    --security-opt no-new-privileges \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000 \
    --mount "type=volume,source=$volume,destination=/data" \
    --env TRINITY_PUSH_GATEWAY_ANDROID_APP_ID=example.android \
    --env TRINITY_PUSH_GATEWAY_IOS_APP_ID=example.ios \
    --env TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL=gateway@example.test \
    --env TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY=test-private-key \
    --env TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID=example-project \
    --env TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY=test-fingerprint-key-32-bytes-long \
    "$@" \
    "$IMAGE_NAME" >/dev/null
  wait_for_status 200 "$GATEWAY_ORIGIN/health"
}

stop_gateway() {
  docker rm --force "$1" >/dev/null
}

expect_delivery_surface() {
  local response_file="$TEMP_DIRECTORY/matrix-response.json"
  container_status 200 GET "$GATEWAY_ORIGIN/health"
  local status
  status="$(
    curl --silent --show-error \
      --header 'content-type: application/json' \
      --data '{"notification":{"devices":[]}}' \
      --output "$response_file" \
      --write-out '%{http_code}' \
      "$GATEWAY_ORIGIN/_matrix/push/v1/notify"
  )"
  [[ "$status" == '200' ]]
  grep --fixed-strings --quiet '"rejected":[]' "$response_file"
}

inspect_image() {
  local container_id
  local filesystem="$TEMP_DIRECTORY/image-files.txt"
  container_id="$(docker create "$IMAGE_NAME")"
  docker export "$container_id" | tar --list > "$filesystem"
  docker rm "$container_id" >/dev/null

  grep --fixed-strings --line-regexp --quiet 'app/main.js' "$filesystem"
  grep --fixed-strings --line-regexp --quiet 'app/admin/index.html' "$filesystem"
  grep --extended-regexp --quiet '^app/admin/(main|styles|chunk)-[^/]+\.(js|css)$' "$filesystem"
  grep --extended-regexp --quiet '^app/admin-migrations/[0-9]{4}_[a-z0-9_]+\.sql$' "$filesystem"
  if grep --extended-regexp --quiet '^app/(.*/)?(node_modules|src)(/|$)|^app/(.*/)?package\.json$|^app/.*\.map$' "$filesystem"; then
    printf '%s\n' 'The final image contains a forbidden development artifact.' >&2
    return 1
  fi
  if grep --extended-regexp '^app/' "$filesystem" | grep --extended-regexp --invert-match --quiet \
    '^app/?$|^app/(main|metrics-writer\.worker)\.js$|^app/admin/?$|^app/admin/index\.html$|^app/admin/(main|styles|chunk)-[^/]+\.(js|css)$|^app/(admin-migrations|migrations)/?$|^app/(admin-migrations|migrations)/[0-9]{4}_[a-z0-9_]+\.sql$'; then
    printf '%s\n' 'The final /app tree contains something outside the runtime allowlist.' >&2
    return 1
  fi
  [[ "$(docker image inspect "$IMAGE_NAME" --format '{{.Config.User}}')" == '1000:1000' ]]
}

inspect_image

start_gateway "$DISABLED_CONTAINER" "$DISABLED_VOLUME"
expect_delivery_surface
container_status 404 GET "$GATEWAY_ORIGIN/admin/"
docker exec "$DISABLED_CONTAINER" bun --no-env-file -e \
  "if ((await import('node:fs')).existsSync('/data/admin.sqlite')) process.exit(1)"
stop_gateway "$DISABLED_CONTAINER"

start_gateway "$INVALID_CONTAINER" "$INVALID_VOLUME" \
  --env TRINITY_PUSH_GATEWAY_ADMIN_ENABLED=true
expect_delivery_surface
container_status 503 GET "$GATEWAY_ORIGIN/admin/overview"
stop_gateway "$INVALID_CONTAINER"

TRINITY_TEST_GATEWAY_ORIGIN="$GATEWAY_ORIGIN" \
  node "$SCRIPT_DIRECTORY/test-oidc-provider.mjs" \
    pocket-id success client_secret_basic \
    >"$TEMP_DIRECTORY/provider.log" 2>&1 &
provider_pid=$!
for _attempt in $(seq 1 60); do
  grep --fixed-strings --quiet '"type":"ready"' "$TEMP_DIRECTORY/provider.log" && break
  kill -0 "$provider_pid" 2>/dev/null || {
    sed -n '1,160p' "$TEMP_DIRECTORY/provider.log" >&2
    exit 1
  }
  sleep 1
done
grep --fixed-strings --quiet '"type":"ready"' "$TEMP_DIRECTORY/provider.log"
provider_issuer="$(
  sed -n 's/^HARNESS .*"issuer":"\([^"]*\)".*$/\1/p' \
    "$TEMP_DIRECTORY/provider.log" | head -n 1
)"
[[ "$provider_issuer" == http://127.0.0.1:* ]]

start_gateway "$ENABLED_CONTAINER" "$ENABLED_VOLUME" \
  --env TRINITY_PUSH_GATEWAY_ADMIN_ENABLED=true \
  --env TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN="$GATEWAY_ORIGIN" \
  --env TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER="$provider_issuer" \
  --env TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_ID=gateway-contract-client \
  --env TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET=test-only-client-secret-000000000000 \
  --env TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP=gateway-operators \
  --env 'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES=openid profile email groups' \
  --env TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD=client_secret_basic \
  --env TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET=test-only-session-secret-0000000000000000

wait_for_status 200 "$GATEWAY_ORIGIN/admin/"
expect_delivery_surface
[[ "$(docker exec "$ENABLED_CONTAINER" bun --no-env-file -e 'process.stdout.write(String(process.getuid?.()))')" == '1000' ]]
[[ "$(docker exec "$ENABLED_CONTAINER" bun --no-env-file -e 'process.stdout.write(String(process.getgid?.()))')" == '1000' ]]
docker exec "$ENABLED_CONTAINER" bun --no-env-file -e \
  "const fs=await import('node:fs/promises');await fs.writeFile('/data/write-probe','ok');await fs.unlink('/data/write-probe')"
if docker exec "$ENABLED_CONTAINER" bun --no-env-file -e \
  "await Bun.write('/app/read-only-probe','not-allowed')"; then
  printf '%s\n' 'The assembled container root filesystem is writable.' >&2
  exit 1
fi
docker exec "$ENABLED_CONTAINER" bun --no-env-file -e \
  "if (!(await import('node:fs')).existsSync('/data/admin.sqlite')) process.exit(1)"

curl --silent --show-error \
  --dump-header "$TEMP_DIRECTORY/admin-headers.txt" \
  --output "$TEMP_DIRECTORY/admin.html" \
  "$GATEWAY_ORIGIN/admin/"
tr -d '\r' < "$TEMP_DIRECTORY/admin-headers.txt" > "$TEMP_DIRECTORY/admin-headers.normalized.txt"
grep --ignore-case --extended-regexp --quiet '^cache-control: no-store$' "$TEMP_DIRECTORY/admin-headers.normalized.txt"
grep --ignore-case --extended-regexp --quiet "^content-security-policy: .*default-src 'none'.*frame-ancestors 'none'.*require-trusted-types-for 'script'" "$TEMP_DIRECTORY/admin-headers.normalized.txt"
grep --ignore-case --extended-regexp --quiet '^cross-origin-opener-policy: same-origin$' "$TEMP_DIRECTORY/admin-headers.normalized.txt"
grep --ignore-case --extended-regexp --quiet '^x-frame-options: DENY$' "$TEMP_DIRECTORY/admin-headers.normalized.txt"
grep --extended-regexp --quiet 'ngcspnonce="[A-Za-z0-9_-]{22}"' "$TEMP_DIRECTORY/admin.html"
! grep --fixed-strings --quiet '__TRINITY_ADMIN_CSP_NONCE__' "$TEMP_DIRECTORY/admin.html"
! grep --extended-regexp --quiet '(src|href)="https?://' "$TEMP_DIRECTORY/admin.html"

container_status 200 GET "$GATEWAY_ORIGIN/admin/metrics"
container_status 404 GET "$GATEWAY_ORIGIN/admin/not-a-route"
container_status 404 POST "$GATEWAY_ORIGIN/admin/overview"

asset_name="$(
  grep --extended-regexp --only-matching '(main|styles|chunk)-[A-Za-z0-9_-]+\.(js|css)' \
    "$TEMP_DIRECTORY/admin.html" | head -n 1
)"
[[ -n "$asset_name" ]]
curl --silent --show-error --head \
  --dump-header "$TEMP_DIRECTORY/asset-headers.txt" \
  --output /dev/null \
  "$GATEWAY_ORIGIN/admin/$asset_name"
tr -d '\r' < "$TEMP_DIRECTORY/asset-headers.txt" > "$TEMP_DIRECTORY/asset-headers.normalized.txt"
grep --ignore-case --extended-regexp --quiet '^cache-control: public, max-age=31536000, immutable$' "$TEMP_DIRECTORY/asset-headers.normalized.txt"
etag="$(sed -n 's/^[Ee][Tt][Aa][Gg]: //p' "$TEMP_DIRECTORY/asset-headers.normalized.txt")"
[[ "$etag" == '"sha256-'*'"' ]]
container_status 304 GET "$GATEWAY_ORIGIN/admin/$asset_name" --header "if-none-match: $etag"

login_result="$(
  curl --silent --show-error \
    --location \
    --max-redirs 20 \
    --cookie-jar "$TEMP_DIRECTORY/cookies.txt" \
    --cookie "$TEMP_DIRECTORY/cookies.txt" \
    --dump-header "$TEMP_DIRECTORY/login-headers.txt" \
    --output "$TEMP_DIRECTORY/login.html" \
    --write-out '%{http_code} %{url_effective}' \
    "$GATEWAY_ORIGIN/admin/auth/login"
)"
[[ "$login_result" == "200 $GATEWAY_ORIGIN/admin/overview" ]]
session_cookie="$(
  grep --ignore-case '^set-cookie: TRINITY_ADMIN_SESSION=' \
    "$TEMP_DIRECTORY/login-headers.txt" | head -n 1
)"
xsrf_cookie="$(
  grep --ignore-case '^set-cookie: TRINITY_ADMIN_XSRF=' \
    "$TEMP_DIRECTORY/login-headers.txt" | head -n 1
)"
for attribute in 'Path=/' 'HttpOnly' 'Secure' 'SameSite=Strict'; do
  grep --fixed-strings --ignore-case --quiet "$attribute" <<<"$session_cookie"
done
for attribute in 'Path=/admin' 'Secure' 'SameSite=Strict'; do
  grep --fixed-strings --ignore-case --quiet "$attribute" <<<"$xsrf_cookie"
done
! grep --fixed-strings --ignore-case --quiet 'HttpOnly' <<<"$xsrf_cookie"
container_status 200 GET "$GATEWAY_ORIGIN/admin/api/v1/session" \
  --cookie "$TEMP_DIRECTORY/cookies.txt"

xsrf_token="$(awk '$6 == "TRINITY_ADMIN_XSRF" { print $7 }' "$TEMP_DIRECTORY/cookies.txt")"
[[ -n "$xsrf_token" ]]
container_status 403 POST "$GATEWAY_ORIGIN/admin/api/v1/backups" \
  --cookie "$TEMP_DIRECTORY/cookies.txt" \
  --header "x-xsrf-token: $xsrf_token" \
  --header 'origin: http://127.0.0.1:9'
container_status 201 POST "$GATEWAY_ORIGIN/admin/api/v1/backups" \
  --cookie "$TEMP_DIRECTORY/cookies.txt" \
  --header "x-xsrf-token: $xsrf_token" \
  --header "origin: $GATEWAY_ORIGIN"
container_status 200 GET "$GATEWAY_ORIGIN/admin/api/v1/backups" \
  --cookie "$TEMP_DIRECTORY/cookies.txt"

kill "$provider_pid"
wait "$provider_pid"
provider_pid=''
container_status 303 GET "$GATEWAY_ORIGIN/admin/auth/login"
expect_delivery_surface

printf '%s\n' \
  'Assembled container smoke passed: disabled, invalid, and enabled isolation; OIDC login; security, cache, CSRF, backup, filesystem, and delivery contracts.'
