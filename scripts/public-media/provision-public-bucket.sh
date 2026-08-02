#!/usr/bin/env bash
# Create Ghostwriter R2 buckets + attach public media domain via Wrangler OAuth.
# No Cloudflare API token required — uses `wrangler login` session.
#
# Usage:
#   wrangler login          # once, browser OAuth
#   ./scripts/public-media/provision-public-bucket.sh
#   ./scripts/public-media/provision-public-bucket.sh --dry-run
#   ./scripts/public-media/provision-public-bucket.sh --private-only
#   ./scripts/public-media/provision-public-bucket.sh --public-only
#
# Real defaults (override with env if needed):
#   private bucket  ghostwriter-capture
#   public bucket   ghostwriter-public-media
#   domain          media.ghost-writer.studio
#   zone            ghost-writer.studio (id resolved via Wrangler OAuth)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OAUTH_HELPER="$ROOT/scripts/lib/cloudflare-wrangler-oauth.mjs"

PRIVATE_BUCKET="${R2_BUCKET_NAME:-ghostwriter-capture}"
PUBLIC_BUCKET="${PUBLIC_R2_BUCKET_NAME:-ghostwriter-public-media}"
DOMAIN="${PUBLIC_MEDIA_DOMAIN:-media.ghost-writer.studio}"
ZONE_NAME="${ZONE_NAME:-ghost-writer.studio}"
ZONE_ID="${ZONE_ID:-}"
DRY_RUN=0
DO_PRIVATE=1
DO_PUBLIC=1

usage() {
  awk 'NR==1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --private-only) DO_PUBLIC=0 ;;
    --public-only) DO_PRIVATE=0 ;;
    --zone-id)
      ZONE_ID="${2:?}"
      shift
      ;;
    -h|--help) usage 0 ;;
    *)
      echo "Unknown flag: $1" >&2
      usage 1
      ;;
  esac
  shift
done

if ! command -v wrangler >/dev/null 2>&1; then
  echo "wrangler is required; install from https://developers.cloudflare.com/workers/wrangler/" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required" >&2
  exit 1
fi

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: $*"
    return 0
  fi
  "$@"
}

echo "Checking Wrangler OAuth..."
if ! ACCOUNT_ID="$(node "$OAUTH_HELPER" account-id 2>/dev/null)"; then
  echo "Wrangler OAuth missing or expired. Run: wrangler login" >&2
  exit 1
fi
echo "  account: $ACCOUNT_ID"

if [[ -z "$ZONE_ID" ]]; then
  echo "Resolving zone id for $ZONE_NAME via Wrangler OAuth..."
  ZONE_ID="$(node "$OAUTH_HELPER" zone-id "$ZONE_NAME")"
fi
echo "  zone:    $ZONE_NAME ($ZONE_ID)"
echo "  private: $PRIVATE_BUCKET"
echo "  public:  $PUBLIC_BUCKET → https://$DOMAIN"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "  mode:    dry-run"
fi
echo

# Detect R2-not-enabled early with a clear message.
if ! wrangler r2 bucket list >/tmp/gw-r2-buckets.txt 2>/tmp/gw-r2-buckets.err; then
  if grep -q "enable R2" /tmp/gw-r2-buckets.err 2>/dev/null; then
    echo "R2 is not enabled on this Cloudflare account yet." >&2
    echo "One dashboard click (no API token):" >&2
    echo "  https://dash.cloudflare.com/${ACCOUNT_ID}/r2/overview" >&2
    echo "Purchase/enable R2, then re-run this script." >&2
    exit 1
  fi
  cat /tmp/gw-r2-buckets.err >&2
  exit 1
fi

bucket_exists() {
  local name="$1"
  awk '{print $1}' /tmp/gw-r2-buckets.txt | grep -Fxq "$name"
}

domain_already_attached() {
  wrangler r2 bucket domain list "$PUBLIC_BUCKET" 2>/dev/null | grep -Fq "$DOMAIN"
}

ensure_bucket() {
  local name="$1"
  if bucket_exists "$name"; then
    echo "Bucket already exists: $name"
    return 0
  fi
  echo "Creating bucket: $name"
  run wrangler r2 bucket create "$name"
  # Refresh list cache after create
  if [[ "$DRY_RUN" -eq 0 ]]; then
    wrangler r2 bucket list >/tmp/gw-r2-buckets.txt 2>/dev/null || true
  fi
}

if [[ "$DO_PRIVATE" -eq 1 ]]; then
  ensure_bucket "$PRIVATE_BUCKET"
fi

if [[ "$DO_PUBLIC" -eq 1 ]]; then
  ensure_bucket "$PUBLIC_BUCKET"
  if domain_already_attached; then
    echo "Domain already attached: $DOMAIN"
  else
    echo "Attaching custom domain: $DOMAIN"
    run wrangler r2 bucket domain add "$PUBLIC_BUCKET" \
      --domain "$DOMAIN" \
      --zone-id "$ZONE_ID" \
      --force
  fi
  echo
  echo "Connected domains:"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: wrangler r2 bucket domain list $PUBLIC_BUCKET"
  else
    wrangler r2 bucket domain list "$PUBLIC_BUCKET" || true
  fi
fi

echo
echo "Done. Next:"
echo "  1. Confirm https://$DOMAIN resolves (DNS may take a few minutes)."
echo "  2. Create R2 S3 API credentials once (Fly cannot use Wrangler OAuth):"
echo "       https://dash.cloudflare.com/${ACCOUNT_ID}/r2/api-tokens"
echo "     Object Read & Write on $PRIVATE_BUCKET + $PUBLIC_BUCKET."
echo "  3. Put keys in apps/backend/.env.fly.local (see fly.env.example), then:"
echo "       ./scripts/setup-fly-backend-secrets.sh --generate-kek --sync-public-media"
echo
echo "Values for .env.fly.local:"
echo "  R2_ACCOUNT_ID=$ACCOUNT_ID"
echo "  R2_BUCKET_NAME=$PRIVATE_BUCKET"
echo "  GHOSTWRITER_PUBLIC_MEDIA_ORIGIN=https://$DOMAIN"
echo "  GHOSTWRITER_PUBLIC_R2_BUCKET_NAME=$PUBLIC_BUCKET"
