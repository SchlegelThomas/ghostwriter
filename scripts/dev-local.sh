#!/usr/bin/env bash
# Start Ghostwriter locally against real Lakebase + Google auth.
#
# Prerequisites:
#   apps/backend/.env  — copy from Fly non-secrets + secrets (see docs/OPERATIONS.md)
#   Google OAuth web client must allow:
#     origins http://localhost:8081 and http://localhost:8787
#     redirect http://localhost:8787/api/auth/callback/google
#
# Usage:
#   ./scripts/dev-local.sh            # backend + Expo web (default)
#   ./scripts/dev-local.sh backend    # backend only
#   ./scripts/dev-local.sh client     # client only (expects backend on :8787)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/apps/backend/.env"
MODE="${1:-all}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. See docs/OPERATIONS.md (Local live-provider smoke configuration)." >&2
  exit 1
fi

load_env() {
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
}

start_backend() {
  load_env
  exec pnpm --filter @ghostwriter/backend dev
}

start_client() {
  exec env EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-http://localhost:8787}" \
    pnpm --filter client web -- --port 8081
}

case "${MODE}" in
  backend) start_backend ;;
  client) start_client ;;
  all)
    load_env
    pnpm --filter @ghostwriter/backend dev &
    BACKEND_PID=$!
    trap 'kill "${BACKEND_PID}" 2>/dev/null || true' EXIT INT TERM
    sleep 2
    curl -sf "http://127.0.0.1:${PORT:-8787}/health" >/dev/null || {
      echo "Backend did not become healthy on port ${PORT:-8787}." >&2
      exit 1
    }
    start_client
    ;;
  *)
    echo "Usage: $0 [all|backend|client]" >&2
    exit 1
    ;;
esac
