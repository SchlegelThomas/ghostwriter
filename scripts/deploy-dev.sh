#!/usr/bin/env bash
# Deploy a dev version of the web app from the current branch.
# Publishes to a per-branch preview URL on Cloudflare Pages.
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH="$(git branch --show-current)"
if [ "$BRANCH" = "main" ]; then
  echo "Refusing to dev-deploy from main. Production deploys happen via CI on merge." >&2
  exit 1
fi

if [ ! -f apps/client/package.json ]; then
  echo "apps/client isn't scaffolded yet — nothing to deploy." >&2
  echo "See docs/ARCHITECTURE.md for the planned layout." >&2
  exit 1
fi

echo "Building web export from branch '$BRANCH'..."
pnpm --filter client exec expo export --platform web

echo "Deploying preview for '$BRANCH' to Cloudflare Pages..."
(
  cd apps/client
  pnpm exec wrangler pages deploy dist --project-name=ghostwriter --branch="$BRANCH"
)
