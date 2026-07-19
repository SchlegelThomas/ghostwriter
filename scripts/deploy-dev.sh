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
# Preview auth must hit same-origin /api (Pages Function → Fly). Never bake a
# local EXPO_PUBLIC_API_URL into the artifact or browsers CORS to localhost.
# Clear Metro cache so a prior local export cannot reuse a baked-in origin.
rm -rf apps/client/dist apps/client/.expo
EXPO_PUBLIC_API_URL= pnpm --filter client exec expo export --platform web --clear

echo "Deploying preview for '$BRANCH' to Cloudflare Pages..."
(
  cd apps/client
  if rg -q '127\.0\.0\.1:8787|localhost:8787' dist/_expo/static/js/web/*.js 2>/dev/null; then
    echo "Refusing deploy: dist still contains a local API origin." >&2
    exit 1
  fi
  pnpm exec wrangler pages deploy dist --project-name=ghostwriter --branch="$BRANCH" --commit-dirty=true
)
