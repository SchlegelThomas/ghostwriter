# Build context is the repository root: `docker build -f apps/backend/Dockerfile .`
FROM node:22-slim

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /app

# Workspace manifests first for cached installs.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/storage/package.json ./packages/storage/package.json
COPY apps/backend/package.json ./apps/backend/package.json

# Install only the backend and its workspace dependencies (excludes the Expo client/UI).
RUN pnpm install --frozen-lockfile --filter "@ghostwriter/backend..."

# Source for the backend and the packages it depends on.
COPY packages/core ./packages/core
COPY packages/storage ./packages/storage
COPY apps/backend ./apps/backend

ENV PORT=8787
EXPOSE 8787

CMD ["pnpm", "--filter", "@ghostwriter/backend", "start"]
