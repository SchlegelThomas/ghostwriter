# Public character media (Cloudflare R2)

Character portrait PNGs for the Harry Potter demo and applied Cast visuals are served from a
**public** R2 bucket with custom domain `https://media.ghost-writer.studio`. Capture attachments
remain on the private bucket `ghostwriter-capture`. See ADR 0017 and `docs/OPERATIONS.md`.

## Prerequisites

- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) via **browser OAuth** (`wrangler login`)
- R2 enabled on the Ghostwriter Cloudflare account
- DNS zone `ghost-writer.studio` on that account
- For Fly: R2 **S3** Access Key ID + Secret (R2 → API Tokens). Store as GitHub secrets
  `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — not the Pages `CLOUDFLARE_API_TOKEN`.

## Production status (2026-08-02)

- Buckets: `ghostwriter-capture`, `ghostwriter-public-media`
- Domain: `media.ghost-writer.studio` (SSL active)
- Demo fixtures synced remote; sample portrait returns HTTP 200
- Fly secrets set via `ops-fly-r2-secrets.yml` (R2 + public media + KEK)

## 1–2. Create buckets + attach custom domain

Idempotent (Wrangler OAuth resolves zone id):

```bash
wrangler login   # once
./scripts/public-media/provision-public-bucket.sh
```

Flags: `--dry-run`, `--private-only`, `--public-only`.

## 3. Sync demo portrait fixtures

```bash
./scripts/public-media/sync-demo-character-visuals.sh
```

Uses `wrangler r2 object put --remote` (Wrangler 4 defaults to local without `--remote`).

## 4. Fly secrets (backend)

Preferred (GitHub Actions; values never printed in logs as plaintext beyond Fly’s secret store):

```bash
gh secret set R2_ACCESS_KEY_ID
gh secret set R2_SECRET_ACCESS_KEY
gh workflow run ops-fly-r2-secrets.yml -f generate_kek=true
```

Local alternative:

```bash
cp apps/backend/fly.env.example apps/backend/.env.fly.local   # fill R2 S3 keys
./scripts/setup-fly-backend-secrets.sh --generate-kek --sync-public-media
```

Demo seed re-puts portrait objects and rewrites locator URLs to public HTTPS on boot when
public media is configured.
