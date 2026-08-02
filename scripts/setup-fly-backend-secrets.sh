#!/usr/bin/env bash
# Configure Fly secrets for ghostwriter-backend: R2, public media, provider KEK,
# demo BYOK seeds, and optional ElevenLabs. Never prints secret values.
#
# Auth: uses `fly auth login` (OAuth). No Cloudflare API token.
# R2 S3 access keys still come from .env.fly.local (dashboard one-time create);
# Wrangler OAuth cannot mint those for the Fly app.
#
# Usage:
#   wrangler login && fly auth login     # once
#   cp apps/backend/fly.env.example apps/backend/.env.fly.local
#   # fill R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY (and optional ElevenLabs)
#   ./scripts/setup-fly-backend-secrets.sh --check
#   ./scripts/setup-fly-backend-secrets.sh --generate-kek --sync-public-media
#
# Env sources (later wins): apps/backend/.env → .env.e2e.local → .env.fly.local
# Then production defaults fill any still-unset non-secret R2/public media fields.
# Demo seeds: GHOSTWRITER_DEMO_SEED_* or fallback GHOSTWRITER_E2E_SEED_*
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OAUTH_HELPER="$ROOT/scripts/lib/cloudflare-wrangler-oauth.mjs"
APP="${FLY_APP:-ghostwriter-backend}"
DRY_RUN=0
CHECK_ONLY=0
GENERATE_KEK=0
SYNC_PUBLIC_MEDIA=0
SKIP_RESTART=0

usage() {
  awk 'NR==1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --check) CHECK_ONLY=1 ;;
    --generate-kek) GENERATE_KEK=1 ;;
    --sync-public-media) SYNC_PUBLIC_MEDIA=1 ;;
    --skip-restart) SKIP_RESTART=1 ;;
    -h|--help) usage 0 ;;
    *)
      echo "Unknown flag: $1" >&2
      usage 1
      ;;
  esac
  shift
done

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  echo "Loading $(basename "$file")" >&2
  eval "$(
    awk '
      /^[[:space:]]*#/ { next }
      /^[[:space:]]*$/ { next }
      /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/ {
        line = $0
        sub(/^[[:space:]]+/, "", line)
        eq = index(line, "=")
        if (eq == 0) next
        key = substr(line, 1, eq - 1)
        val = substr(line, eq + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
        if (val ~ /^".*"$/) { val = substr(val, 2, length(val) - 2) }
        else if (val ~ /^'\''.*'\''$/) { val = substr(val, 2, length(val) - 2) }
        gsub(/\\/, "\\\\", val)
        gsub(/"/, "\\\"", val)
        printf "export %s=\"%s\"\n", key, val
      }
    ' "$file"
  )"
}

is_set() {
  local key="$1"
  local val="${!key-}"
  [[ -n "${val// }" ]]
}

map_demo_seeds_from_e2e() {
  local pairs=(
    "GHOSTWRITER_DEMO_SEED_OPENAI_KEY:GHOSTWRITER_E2E_SEED_OPENAI_KEY"
    "GHOSTWRITER_DEMO_SEED_ANTHROPIC_KEY:GHOSTWRITER_E2E_SEED_ANTHROPIC_KEY"
    "GHOSTWRITER_DEMO_SEED_GOOGLE_KEY:GHOSTWRITER_E2E_SEED_GOOGLE_KEY"
  )
  local pair demo e2e
  for pair in "${pairs[@]}"; do
    demo="${pair%%:*}"
    e2e="${pair##*:}"
    if ! is_set "$demo" && is_set "$e2e"; then
      export "$demo=${!e2e}"
      echo "Mapped $e2e → $demo" >&2
    fi
  done
}

maybe_generate_kek() {
  if is_set GHOSTWRITER_PROVIDER_KEK_V1; then
    return 0
  fi
  if [[ "$GENERATE_KEK" -ne 1 ]]; then
    return 0
  fi
  local generated
  generated="$(openssl rand -base64 32)"
  export GHOSTWRITER_PROVIDER_KEK_V1="$generated"
  export GHOSTWRITER_PROVIDER_KEK_ACTIVE="${GHOSTWRITER_PROVIDER_KEK_ACTIVE:-V1}"
  echo "Generated GHOSTWRITER_PROVIDER_KEK_V1 (also write it into .env.fly.local for recovery)" >&2
  if [[ -f "$ROOT/apps/backend/.env.fly.local" ]]; then
    if ! grep -q '^GHOSTWRITER_PROVIDER_KEK_V1=' "$ROOT/apps/backend/.env.fly.local"; then
      {
        echo ""
        echo "# Generated $(date -u +%Y-%m-%dT%H:%MZ) — keep offline backup"
        echo "GHOSTWRITER_PROVIDER_KEK_V1=$generated"
        echo "GHOSTWRITER_PROVIDER_KEK_ACTIVE=V1"
      } >>"$ROOT/apps/backend/.env.fly.local"
      echo "Appended KEK to apps/backend/.env.fly.local" >&2
    fi
  fi
}

require_group() {
  local label="$1"
  shift
  local missing=()
  local key
  for key in "$@"; do
    if ! is_set "$key"; then
      missing+=("$key")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Missing $label: ${missing[*]}" >&2
    return 1
  fi
  echo "OK $label (${#} keys)" >&2
  return 0
}

# Soft groups: warn but continue
check_optional_group() {
  local label="$1"
  shift
  local present=0
  local key
  for key in "$@"; do
    if is_set "$key"; then
      present=$((present + 1))
    fi
  done
  if [[ "$present" -eq 0 ]]; then
    echo "SKIP $label (none set)" >&2
    return 1
  fi
  if [[ "$present" -ne $# ]]; then
    echo "ERROR $label: set all or none of: $*" >&2
    return 2
  fi
  echo "OK $label" >&2
  return 0
}

collect_set_args() {
  local keys=("$@")
  local args=()
  local key
  for key in "${keys[@]}"; do
    if is_set "$key"; then
      args+=("${key}=${!key}")
    fi
  done
  printf '%s\n' "${args[@]}"
}

apply_production_defaults() {
  # Fill non-secret production R2/public-media fields only when S3 access keys
  # are present — otherwise we'd look "half configured" and fail validation.
  if ! is_set R2_ACCESS_KEY_ID || ! is_set R2_SECRET_ACCESS_KEY; then
    echo "R2 S3 access keys not in env yet — skipping R2/public-media defaults" >&2
    echo "  Create keys: https://dash.cloudflare.com/dd0edd263f71cb4108826464f45e0045/r2/api-tokens" >&2
    echo "  Then set R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY in .env.fly.local" >&2
    return 0
  fi
  if ! is_set R2_ACCOUNT_ID; then
    if ACCOUNT_ID="$(node "$OAUTH_HELPER" account-id 2>/dev/null)"; then
      export R2_ACCOUNT_ID="$ACCOUNT_ID"
      echo "Defaulted R2_ACCOUNT_ID from Wrangler OAuth" >&2
    else
      export R2_ACCOUNT_ID="dd0edd263f71cb4108826464f45e0045"
      echo "Defaulted R2_ACCOUNT_ID to Ghostwriter Cloudflare account" >&2
    fi
  fi
  if ! is_set R2_BUCKET_NAME; then
    export R2_BUCKET_NAME="ghostwriter-capture"
    echo "Defaulted R2_BUCKET_NAME=$R2_BUCKET_NAME" >&2
  fi
  if ! is_set GHOSTWRITER_PUBLIC_MEDIA_ORIGIN; then
    export GHOSTWRITER_PUBLIC_MEDIA_ORIGIN="https://media.ghost-writer.studio"
    echo "Defaulted GHOSTWRITER_PUBLIC_MEDIA_ORIGIN" >&2
  fi
  if ! is_set GHOSTWRITER_PUBLIC_R2_BUCKET_NAME; then
    export GHOSTWRITER_PUBLIC_R2_BUCKET_NAME="ghostwriter-public-media"
    echo "Defaulted GHOSTWRITER_PUBLIC_R2_BUCKET_NAME" >&2
  fi
}

require_fly_oauth() {
  if ! command -v fly >/dev/null 2>&1; then
    echo "fly CLI required (https://fly.io/docs/flyctl/)" >&2
    exit 1
  fi
  if ! fly auth whoami >/dev/null 2>&1; then
    echo "Fly OAuth missing. Run: fly auth login" >&2
    exit 1
  fi
  echo "Fly auth: $(fly auth whoami 2>/dev/null)" >&2
}

load_env_file "$ROOT/apps/backend/.env"
load_env_file "$ROOT/apps/backend/.env.e2e.local"
load_env_file "$ROOT/apps/backend/.env.fly.local"
map_demo_seeds_from_e2e
apply_production_defaults
maybe_generate_kek

echo "" >&2
echo "Validating secret groups for app=$APP ..." >&2

ERRORS=0

# R2 private is optional until Capture media / public portraits are enabled.
# Partial R2 or public-media sets are hard errors (boot used to crash; now soft-fails but still broken).
R2_STATUS=0
check_optional_group "private R2" \
  R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME || R2_STATUS=$?
if [[ "$R2_STATUS" -eq 2 ]]; then
  ERRORS=$((ERRORS + 1))
fi

PUBLIC_MEDIA_STATUS=0
check_optional_group "public media" \
  GHOSTWRITER_PUBLIC_MEDIA_ORIGIN GHOSTWRITER_PUBLIC_R2_BUCKET_NAME || PUBLIC_MEDIA_STATUS=$?
if [[ "$PUBLIC_MEDIA_STATUS" -eq 2 ]]; then
  ERRORS=$((ERRORS + 1))
elif [[ "$PUBLIC_MEDIA_STATUS" -eq 0 ]]; then
  if [[ "$R2_STATUS" -ne 0 ]]; then
    echo "ERROR public media requires all private R2_* credentials" >&2
    ERRORS=$((ERRORS + 1))
  fi
fi

if is_set GHOSTWRITER_PROVIDER_KEK_V1 || is_set GHOSTWRITER_PROVIDER_KEK_ACTIVE; then
  if ! require_group "provider KEK" GHOSTWRITER_PROVIDER_KEK_V1 GHOSTWRITER_PROVIDER_KEK_ACTIVE; then
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "SKIP provider KEK (demo BYOK encryption will stay unavailable)" >&2
  echo "     re-run with --generate-kek or set keys in .env.fly.local" >&2
fi

DEMO_COUNT=0
for key in GHOSTWRITER_DEMO_SEED_OPENAI_KEY GHOSTWRITER_DEMO_SEED_ANTHROPIC_KEY GHOSTWRITER_DEMO_SEED_GOOGLE_KEY; do
  if is_set "$key"; then DEMO_COUNT=$((DEMO_COUNT + 1)); fi
done
if [[ "$DEMO_COUNT" -eq 0 ]]; then
  echo "SKIP demo BYOK seeds" >&2
else
  echo "OK demo BYOK seeds ($DEMO_COUNT providers)" >&2
fi

if is_set ELEVENLABS_API_KEY; then
  echo "OK ElevenLabs API key" >&2
else
  echo "SKIP ELEVENLABS_API_KEY (Reader Play stays unavailable)" >&2
fi

if [[ "$ERRORS" -gt 0 ]]; then
  echo "" >&2
  echo "Fix the errors above, then re-run." >&2
  echo "Template: apps/backend/fly.env.example → apps/backend/.env.fly.local" >&2
  exit 1
fi

SECRET_KEYS=(
  DATABRICKS_CLIENT_SECRET
  BETTER_AUTH_SECRET
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  GHOSTWRITER_PROVIDER_KEK_V1
  GHOSTWRITER_PROVIDER_KEK_ACTIVE
  GHOSTWRITER_DEMO_SEED_OPENAI_KEY
  GHOSTWRITER_DEMO_SEED_ANTHROPIC_KEY
  GHOSTWRITER_DEMO_SEED_GOOGLE_KEY
  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET_NAME
  GHOSTWRITER_PUBLIC_MEDIA_ORIGIN
  GHOSTWRITER_PUBLIC_R2_BUCKET_NAME
  ELEVENLABS_API_KEY
  ELEVENLABS_VOICE_DEFAULT
  ELEVENLABS_VOICE_NARRATIVE
  ELEVENLABS_VOICE_NOIR
  ELEVENLABS_VOICE_SOFT
)

SET_ARGS=()
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  SET_ARGS+=("$line")
done < <(collect_set_args "${SECRET_KEYS[@]}")

if [[ ${#SET_ARGS[@]} -eq 0 ]]; then
  echo "Nothing to set from local env files." >&2
  exit 1
fi

echo "" >&2
echo "Will set ${#SET_ARGS[@]} secrets on $APP:" >&2
for arg in "${SET_ARGS[@]}"; do
  echo "  - ${arg%%=*}" >&2
done

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  echo "Check-only complete." >&2
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry-run: not calling fly." >&2
  exit 0
fi

require_fly_oauth

echo "" >&2
echo "Setting secrets (Fly will redeploy)..." >&2
fly secrets set -a "$APP" "${SET_ARGS[@]}"

if [[ "$SYNC_PUBLIC_MEDIA" -eq 1 ]]; then
  if [[ "$PUBLIC_MEDIA_STATUS" -ne 0 ]]; then
    echo "Cannot --sync-public-media without public media secrets configured." >&2
    exit 1
  fi
  echo "Syncing demo character visuals via Wrangler..." >&2
  PUBLIC_R2_BUCKET_NAME="${GHOSTWRITER_PUBLIC_R2_BUCKET_NAME}" \
    "$ROOT/scripts/public-media/sync-demo-character-visuals.sh"
fi

if [[ "$SKIP_RESTART" -eq 0 ]]; then
  # fly secrets set already restarts; explicit restart helps if only sync ran.
  echo "Ensuring machines are started..." >&2
  fly machines list -a "$APP" --json 2>/dev/null \
    | node -e '
        let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
          const machines=JSON.parse(s||"[]");
          for (const m of machines) console.log(m.id||"");
        });
      ' \
    | while read -r mid; do
        [[ -n "$mid" ]] || continue
        fly machines start "$mid" -a "$APP" >/dev/null 2>&1 || true
      done
  echo "Waiting for health..." >&2
  sleep 8
  curl -fsS "https://${APP}.fly.dev/health" >/dev/null \
    && echo "Health OK: https://${APP}.fly.dev/health" \
    || echo "Health check failed — inspect: fly logs -a $APP" >&2
fi

echo "" >&2
echo "Done. Verify:" >&2
echo "  fly secrets list -a $APP" >&2
echo "  curl -sS https://${APP}.fly.dev/health" >&2
echo "  curl -sS -o /dev/null -w '%{http_code}\\n' https://${APP}.fly.dev/api/me   # expect 401 signed-out" >&2
