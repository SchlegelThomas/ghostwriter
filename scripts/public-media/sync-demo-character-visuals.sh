#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURES_DIR="$ROOT/packages/core/fixtures/harry-potter-visuals"
BUCKET="${PUBLIC_R2_BUCKET_NAME:-ghostwriter-public-media}"
LIST_SCRIPT="$ROOT/scripts/public-media/list-demo-character-visual-keys.mjs"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "wrangler is required; install from https://developers.cloudflare.com/workers/wrangler/" >&2
  exit 1
fi

if [[ ! -d "$FIXTURES_DIR" ]]; then
  echo "Fixture directory not found: $FIXTURES_DIR" >&2
  exit 1
fi

while IFS=$'\t' read -r objectKey filename; do
  filePath="$FIXTURES_DIR/$filename"
  if [[ ! -f "$filePath" ]]; then
    echo "Missing fixture: $filePath" >&2
    exit 1
  fi
  echo "Uploading $objectKey"
  # Wrangler 4 defaults object puts to local persistence; production needs --remote.
  wrangler r2 object put "$BUCKET/$objectKey" \
    --remote \
    --file "$filePath" \
    --content-type "image/png"
done < <(node "$LIST_SCRIPT")

echo "Synced demo character visuals to bucket $BUCKET"
