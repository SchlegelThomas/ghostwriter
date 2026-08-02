#!/usr/bin/env bash
# Push local BYOK seed keys to Fly as GHOSTWRITER_DEMO_SEED_* secrets.
# Reads apps/backend/.env.e2e.local by default (gitignored). Never prints key values.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT/apps/backend/.env.e2e.local}"
APP="${FLY_APP:-ghostwriter-backend}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Copy apps/backend/e2e.env.example → apps/backend/.env.e2e.local and fill keys." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
# Only load KEY=VALUE lines; ignore comments/blank.
# Values may be quoted; unquote lightly.
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
      # Escape for eval assignment
      gsub(/\\/, "\\\\", val)
      gsub(/"/, "\\\"", val)
      printf "export %s=\"%s\"\n", key, val
    }
  ' "$ENV_FILE"
)"
set +a

openai="${GHOSTWRITER_DEMO_SEED_OPENAI_KEY:-${GHOSTWRITER_E2E_SEED_OPENAI_KEY:-}}"
anthropic="${GHOSTWRITER_DEMO_SEED_ANTHROPIC_KEY:-${GHOSTWRITER_E2E_SEED_ANTHROPIC_KEY:-}}"
google="${GHOSTWRITER_DEMO_SEED_GOOGLE_KEY:-${GHOSTWRITER_E2E_SEED_GOOGLE_KEY:-}}"

args=()
missing=()

if [[ -n "$openai" ]]; then
  args+=("GHOSTWRITER_DEMO_SEED_OPENAI_KEY=${openai}")
else
  missing+=("OPENAI")
fi
if [[ -n "$anthropic" ]]; then
  args+=("GHOSTWRITER_DEMO_SEED_ANTHROPIC_KEY=${anthropic}")
else
  missing+=("ANTHROPIC")
fi
if [[ -n "$google" ]]; then
  args+=("GHOSTWRITER_DEMO_SEED_GOOGLE_KEY=${google}")
else
  missing+=("GOOGLE")
fi

if [[ ${#args[@]} -eq 0 ]]; then
  echo "No seed keys found in $ENV_FILE" >&2
  echo "Expected GHOSTWRITER_E2E_SEED_*_KEY or GHOSTWRITER_DEMO_SEED_*_KEY." >&2
  exit 1
fi

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Skipping empty providers: ${missing[*]}" >&2
fi

echo "Setting ${#args[@]} DEMO_SEED secret(s) on Fly app ${APP} (from ${ENV_FILE})"
echo "Key values are not printed."

fly secrets set "${args[@]}" --app "$APP"

echo "Done. Restart/redeploy the backend if secrets were staged-only on your Fly plan."
