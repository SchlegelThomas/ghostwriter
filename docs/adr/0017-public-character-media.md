# 0017: Public character portrait media vs private Capture

- Status: accepted
- Date: 2026-08-02
- Plan: `plans/archive/2026-08-02-public-media-demo-reader/plan.html`
- Related: ADR 0010 (private Capture attachments), ADR 0005 (demo seed), ADR 0012 (BYOK / KEK)

## Context

Cast character portraits (demo Harry Potter fixtures and applied Cast visuals) need to render in
production without a private authenticated download hop. Capture attachments and book covers must
remain private (ADR 0010). The backend already uses S3-compatible R2 credentials on Fly; Wrangler
OAuth can provision buckets and sync objects but cannot mint those S3 keys for the Node app.

## Decision

- **Public character media** lives in a separate R2 bucket (`ghostwriter-public-media`) served at
  `https://media.ghost-writer.studio/<object-key>` (custom domain on the same Cloudflare account).
- When `GHOSTWRITER_PUBLIC_MEDIA_ORIGIN` and `GHOSTWRITER_PUBLIC_R2_BUCKET_NAME` are set **together
  with** private `R2_*` credentials, applied Cast visuals and demo portrait seed write/persist
  public HTTPS URLs. Incomplete public-media config soft-fails at boot (warn + disable) rather than
  crashing the process.
- **Private Capture attachments and book covers** stay on `ghostwriter-capture` with Fly-authorized
  short-lived URLs. Character public URLs never authorize Capture bytes.
- Provision/sync use Wrangler OAuth (`scripts/public-media/`). Fly receives S3 keys from GitHub
  secrets `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` via `ops-fly-r2-secrets.yml` (or local
  `apps/backend/.env.fly.local`). Pages’ `CLOUDFLARE_API_TOKEN` is not an R2 S3 credential.

## Options considered

- Single private bucket + download API for Cast thumbs — works, but adds latency and auth noise for
  intentionally public demo/Cast art.
- Public Capture attachments — rejected; ADR 0010 private boundary stands.
- Wrangler-only auth for Fly — rejected; Node `aws4fetch` path requires long-lived S3 keys.

## Consequences

- Demo Cast portraits can load as ordinary `<img>` URLs in production.
- Operators must keep public-media Fly secrets complete; half-config is ignored safely.
- Rotating R2 S3 keys requires updating GitHub `R2_*` secrets and re-running the ops workflow (or
  local Fly secrets set). Provider KEK remains a separate Fly secret set (`GHOSTWRITER_PROVIDER_KEK_*`).
