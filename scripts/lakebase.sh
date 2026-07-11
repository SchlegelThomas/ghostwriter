#!/usr/bin/env bash
# Ghostwriter <-> Databricks Lakebase helper.
#
# Wraps the Databricks CLI (`databricks postgres ...`) for the operations our CI/CD and local
# workflows need: create/reset/delete a database branch, print a connection, and run migrations
# against a branch. The Postgres/Lakebase APIs are Beta; adjust flags here if the CLI changes.
#
# Configuration (environment variables):
#   DATABRICKS_PROFILE     Optional CLI profile (e.g. "ghostwriter"). If unset, relies on
#                          DATABRICKS_HOST + DATABRICKS_CLIENT_ID/SECRET env auth (used in CI).
#   LAKEBASE_PROJECT_ID    Required. The Lakebase Autoscaling project id.
#   LAKEBASE_SOURCE_BRANCH Branch to fork from (default: production).
#   LAKEBASE_ENDPOINT_ID   Endpoint id used for connections (default: primary).
#   LAKEBASE_DB            Postgres database name (default: databricks_postgres).
#   LAKEBASE_USER          Required for `url`/`migrate`: the Postgres role/identity to connect as.
#
# Usage:
#   scripts/lakebase.sh create-branch <branch-id> [ttl-seconds]
#   scripts/lakebase.sh delete-branch <branch-id>
#   scripts/lakebase.sh migrate       <branch-id>
#   scripts/lakebase.sh env           <branch-id>   # prints export lines for PG* connection vars
set -euo pipefail

: "${LAKEBASE_PROJECT_ID:?Set LAKEBASE_PROJECT_ID}"
SOURCE_BRANCH="${LAKEBASE_SOURCE_BRANCH:-production}"
ENDPOINT_ID="${LAKEBASE_ENDPOINT_ID:-primary}"
DB_NAME="${LAKEBASE_DB:-databricks_postgres}"

PROFILE_ARGS=()
if [ -n "${DATABRICKS_PROFILE:-}" ]; then
  PROFILE_ARGS=(--profile "$DATABRICKS_PROFILE")
fi

dbx() {
  databricks "$@" "${PROFILE_ARGS[@]}"
}

require_jq() {
  command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }
}

cmd_create_branch() {
  local branch_id="$1"
  local ttl="${2:-172800}" # default 2 days
  echo "Creating Lakebase branch '$branch_id' from '$SOURCE_BRANCH' (ttl ${ttl}s)..." >&2
  dbx postgres create-branch "projects/${LAKEBASE_PROJECT_ID}" "$branch_id" --json "{
    \"spec\": {
      \"source_branch\": \"projects/${LAKEBASE_PROJECT_ID}/branches/${SOURCE_BRANCH}\",
      \"ttl\": \"${ttl}s\"
    }
  }"
}

cmd_delete_branch() {
  local branch_id="$1"
  echo "Deleting Lakebase branch '$branch_id'..." >&2
  dbx postgres delete-branch "projects/${LAKEBASE_PROJECT_ID}/branches/${branch_id}"
}

# Prints `export PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=... PGSSLMODE=require`
cmd_env() {
  require_jq
  : "${LAKEBASE_USER:?Set LAKEBASE_USER}"
  local branch_id="$1"
  local endpoint="projects/${LAKEBASE_PROJECT_ID}/branches/${branch_id}/endpoints/${ENDPOINT_ID}"

  local host
  host="$(dbx postgres get-endpoint "$endpoint" -o json \
    | jq -r '.status.hosts.host // .status.host // .host // empty')"
  if [ -z "$host" ]; then
    echo "Could not resolve endpoint host for $endpoint" >&2
    exit 1
  fi

  local token
  token="$(dbx postgres generate-database-credential "$endpoint" -o json | jq -r '.token')"
  if [ -z "$token" ] || [ "$token" = "null" ]; then
    echo "Could not generate a database credential for $endpoint" >&2
    exit 1
  fi

  echo "export PGHOST='${host}'"
  echo "export PGPORT='5432'"
  echo "export PGUSER='${LAKEBASE_USER}'"
  echo "export PGPASSWORD='${token}'"
  echo "export PGDATABASE='${DB_NAME}'"
  echo "export PGSSLMODE='require'"
}

cmd_migrate() {
  local branch_id="$1"
  # shellcheck disable=SC1090
  eval "$(cmd_env "$branch_id")"
  echo "Running migrations against branch '$branch_id'..." >&2
  pnpm --filter @ghostwriter/storage db:migrate
}

main() {
  local command="${1:-}"
  shift || true
  case "$command" in
    create-branch) cmd_create_branch "$@" ;;
    delete-branch) cmd_delete_branch "$@" ;;
    env)           cmd_env "$@" ;;
    migrate)       cmd_migrate "$@" ;;
    *)
      echo "Usage: scripts/lakebase.sh {create-branch|delete-branch|migrate|env} <branch-id> [ttl-seconds]" >&2
      exit 1
      ;;
  esac
}

main "$@"
