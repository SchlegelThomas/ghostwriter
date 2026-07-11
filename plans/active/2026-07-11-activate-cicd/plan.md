# Activate CI/CD

**Goal:** Make the committed GitHub Actions and Cloudflare Pages deployment path operable before product work begins.
**Status:** active

## Approach
Add manual CI dispatch for an immediate smoke test, configure branch protection only after the check name is verified, and add Cloudflare credentials after the user supplies a scoped API token.

## Checklist
- [x] Add CI manual dispatch and test workflow execution
- [x] Configure and verify main branch protection
- [ ] Add Cloudflare deployment credentials and verify Pages project access
- [ ] Update breadcrumbs and archive plan
