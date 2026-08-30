#!/usr/bin/env bash
set -Eeuo pipefail

pages_error() {
  printf 'ERROR: %s\n' "$*" >&2
}

pages_require_directory() {
  local -r name="$1"
  local -r directory="$2"
  if [[ ! -d "$directory" ]]; then
    pages_error "$name is not a directory: $directory"
    return 1
  fi
  if [[ ! -f "$directory/index.html" ]]; then
    pages_error "$name does not contain index.html: $directory"
    return 1
  fi
  if find "$directory" -type l -print -quit | grep -q .; then
    pages_error "$name contains a symbolic link."
    return 1
  fi
}

pages_replace_directory() {
  local -r source="$1"
  local -r target="$2"
  mkdir -p -- "$target"
  find "$target" -mindepth 1 -delete
  cp -a -- "$source/." "$target/"
}

: "${TRINITY_PAGES_HISTORY_DIR:?TRINITY_PAGES_HISTORY_DIR is required}"
: "${TRINITY_PAGES_NEXT_DIR:?TRINITY_PAGES_NEXT_DIR is required}"

history_directory="$(realpath -- "$TRINITY_PAGES_HISTORY_DIR")"
if [[ "$history_directory" == / ]]; then
  pages_error 'Refusing to assemble Pages history in the filesystem root.'
  exit 1
fi

pages_require_directory 'TRINITY_PAGES_NEXT_DIR' "$TRINITY_PAGES_NEXT_DIR"
pages_replace_directory "$TRINITY_PAGES_NEXT_DIR" "$history_directory/next"

release_tag="${TRINITY_PAGES_RELEASE_TAG:-}"
release_directory="${TRINITY_PAGES_RELEASE_DIR:-}"
latest_directory="${TRINITY_PAGES_LATEST_DIR:-}"
if [[ -n "$release_tag" || -n "$release_directory" || -n "$latest_directory" ]]; then
  if [[ ! "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    pages_error 'TRINITY_PAGES_RELEASE_TAG must be an immutable vX.Y.Z tag.'
    exit 1
  fi
  if [[ -z "$release_directory" || -z "$latest_directory" ]]; then
    pages_error 'Release, latest, and tag inputs must be provided together.'
    exit 1
  fi
  pages_require_directory 'TRINITY_PAGES_RELEASE_DIR' "$release_directory"
  pages_require_directory 'TRINITY_PAGES_LATEST_DIR' "$latest_directory"
  version_target="$history_directory/$release_tag"
  if [[ -e "$version_target" ]]; then
    if ! diff --brief --recursive "$release_directory" "$version_target" >/dev/null; then
      pages_error "Released documentation already exists with different output: $release_tag"
      exit 1
    fi
  else
    mkdir -- "$version_target"
    cp -a -- "$release_directory/." "$version_target/"
  fi
  pages_replace_directory "$latest_directory" "$history_directory/latest"
fi

mapfile -t versions < <(
  find "$history_directory" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V -r \
    || true
)
latest_version="${versions[0]:-}"
node -e '
  const [target, latest, ...versions] = process.argv.slice(1);
  require("node:fs").writeFileSync(
    target,
    `${JSON.stringify({ latest: latest || null, versions }, null, 2)}\n`,
  );
' "$history_directory/versions.json" "$latest_version" "${versions[@]}"

redirect_channel='next'
if [[ -f "$history_directory/latest/index.html" ]]; then
  redirect_channel='latest'
fi
redirect_path="/trinity-push-gateway/$redirect_channel/"
printf '%s\n' \
  '<!doctype html>' \
  '<html lang="en">' \
  '<head>' \
  '<meta charset="utf-8">' \
  '<meta name="viewport" content="width=device-width,initial-scale=1">' \
  "<meta http-equiv=\"refresh\" content=\"0;url=$redirect_path\">" \
  "<link rel=\"canonical\" href=\"$redirect_path\">" \
  '<title>Trinity Push Gateway documentation</title>' \
  '</head>' \
  "<body><p><a href=\"$redirect_path\">Open the documentation</a></p></body>" \
  '</html>' > "$history_directory/index.html"
cp -- "$history_directory/index.html" "$history_directory/404.html"
: > "$history_directory/.nojekyll"
