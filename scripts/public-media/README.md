# Public character media (Cloudflare R2)

Character portrait PNGs for the Harry Potter demo and applied Cast visuals can be served from a **public** R2 bucket with a custom domain. Capture attachments remain on the private bucket.

## Prerequisites

- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) authenticated to the Ghostwriter Cloudflare account
- DNS zone for `ghost-writer.studio` (or your chosen media hostname)
- Existing private R2 credentials on Fly (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`)

## 1. Create the public bucket

```bash
wrangler r2 bucket create ghostwriter-public-media
```

## 2. Attach a custom domain

Replace `$ZONE_ID` with the Cloudflare zone id for `ghost-writer.studio`:

```bash
wrangler r2 bucket domain add ghostwriter-public-media \
  --domain media.ghost-writer.studio \
  --zone-id "$ZONE_ID"
```

Public objects are then available at `https://media.ghost-writer.studio/<object-key>`.

## 3. Sync demo portrait fixtures

From the repo root (requires Wrangler + network):

```bash
./scripts/public-media/sync-demo-character-visuals.sh
```

Override the bucket name with `PUBLIC_R2_BUCKET_NAME` if needed.

## 4. Fly secrets (backend)

Set on the Ghostwriter Fly app (reuse the same R2 account keys as the private bucket):

```bash
fly secrets set \
  GHOSTWRITER_PUBLIC_MEDIA_ORIGIN=https://media.ghost-writer.studio \
  GHOSTWRITER_PUBLIC_R2_BUCKET_NAME=ghostwriter-public-media
```

Restart the backend. Demo seed re-puts portrait objects to the public bucket and rewrites existing locator URLs to public HTTPS URLs on boot.

See `docs/OPERATIONS.md` for the full operations note.
