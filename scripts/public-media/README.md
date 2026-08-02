# Public character media (Cloudflare R2)

Character portrait PNGs for the Harry Potter demo and applied Cast visuals can be served from a **public** R2 bucket with a custom domain. Capture attachments remain on the private bucket.

## Prerequisites

- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) via **browser OAuth** (`wrangler login`) — no Cloudflare API token
- R2 enabled on the Ghostwriter Cloudflare account (one dashboard toggle if not already)
- DNS zone `ghost-writer.studio` on that account
- For Fly: one-time R2 **S3** access keys (dashboard → R2 → API Tokens). Wrangler OAuth
  can create buckets/domains/sync objects; the Fly Node backend still needs S3 keys.

## 1–2. Create buckets + attach custom domain

Uses Wrangler OAuth to resolve the real zone id for `ghost-writer.studio` and creates
both the private Capture bucket and the public media bucket:

```bash
wrangler login   # once
./scripts/public-media/provision-public-bucket.sh
# or end-to-end:
./scripts/setup-production-media.sh
```

Real defaults: `ghostwriter-capture`, `ghostwriter-public-media`,
`media.ghost-writer.studio`. Flags: `--dry-run`, `--private-only`, `--public-only`.

Public objects are then available at `https://media.ghost-writer.studio/<object-key>`.

## 3. Sync demo portrait fixtures

From the repo root (requires Wrangler + network):

```bash
./scripts/public-media/sync-demo-character-visuals.sh
```

Override the bucket name with `PUBLIC_R2_BUCKET_NAME` if needed.

## 4. Fly secrets (backend)

Prefer the full setup script (R2 private + public media + KEK + demo seeds together):

```bash
cp apps/backend/fly.env.example apps/backend/.env.fly.local   # fill R2_* and public media
./scripts/setup-fly-backend-secrets.sh --generate-kek --sync-public-media
```

Or set only public media (reuse the same R2 account keys as the private bucket — **all**
`R2_*` must already be on Fly, or the backend disables public media at boot):

```bash
fly secrets set \
  GHOSTWRITER_PUBLIC_MEDIA_ORIGIN=https://media.ghost-writer.studio \
  GHOSTWRITER_PUBLIC_R2_BUCKET_NAME=ghostwriter-public-media
```

Demo seed re-puts portrait objects to the public bucket and rewrites existing locator URLs to
public HTTPS URLs on boot. See `docs/OPERATIONS.md`.
