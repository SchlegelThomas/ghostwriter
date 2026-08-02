#!/usr/bin/env bash
# End-to-end Ghostwriter media setup using CLI OAuth (no Cloudflare API token).
#
#   1. wrangler login  +  fly auth login
#   2. Enable R2 once in the dashboard (script detects if missing)
#   3. Create private + public buckets and attach media.ghost-writer.studio
#   4. Sync demo portraits
#   5. Push Fly secrets (needs one-time R2 S3 access keys in .env.fly.local)
#
# Usage:
#   ./scripts/setup-production-media.sh
#   ./scripts/setup-production-media.sh --provision-only
#   ./scripts/setup-production-media.sh --dry-run
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=0
PROVISION_ONLY=0
SKIP_SYNC=0

usage() {
  awk 'NR==1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --provision-only) PROVISION_ONLY=1 ;;
    --skip-sync) SKIP_SYNC=1 ;;
    -h|--help) usage 0 ;;
    *)
      echo "Unknown flag: $1" >&2
      usage 1
      ;;
  esac
  shift
done

echo "==> Wrangler OAuth"
if ! wrangler whoami >/dev/null 2>&1; then
  echo "Not logged in. Opening wrangler login..."
  wrangler login
fi
wrangler whoami 2>&1 | sed -n '1,20p'

echo
echo "==> Fly OAuth"
if ! fly auth whoami >/dev/null 2>&1; then
  echo "Not logged in. Opening fly auth login..."
  fly auth login
fi
echo "Fly: $(fly auth whoami)"

echo
echo "==> Provision R2 buckets + public domain"
if [[ "$DRY_RUN" -eq 1 ]]; then
  "$ROOT/scripts/public-media/provision-public-bucket.sh" --dry-run
else
  "$ROOT/scripts/public-media/provision-public-bucket.sh"
fi

if [[ "$PROVISION_ONLY" -eq 1 ]]; then
  echo "Provision-only complete."
  exit 0
fi

if [[ "$SKIP_SYNC" -eq 0 && "$DRY_RUN" -eq 0 ]]; then
  echo
  echo "==> Sync demo character visuals (remote)"
  "$ROOT/scripts/public-media/sync-demo-character-visuals.sh"
fi

echo
echo "==> Fly R2 + public-media secrets from GitHub Actions secrets"
echo "    (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / FLY_API_TOKEN — values never printed)"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "DRY-RUN: would dispatch ops-fly-r2-secrets workflow"
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI required to dispatch the secrets workflow" >&2
  exit 1
fi

gh workflow run ops-fly-r2-secrets.yml \
  --repo SchlegelThomas/ghostwriter \
  -f generate_kek=true

echo "Dispatched. Watch with: gh run watch --repo SchlegelThomas/ghostwriter"
echo "Optional local KEK/demo seeds remain: ./scripts/setup-fly-backend-secrets.sh --generate-kek"