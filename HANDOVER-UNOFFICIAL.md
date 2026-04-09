# HANDOVER — Unofficial LINE Status & Immediate Production Mode

_Last updated: 2026-04-09_

## Current status
- Official LINE path is production-ready.
- Unofficial LINE path remains experimental due to unstable auth/session behavior.

## Immediate production configuration (recommended)
Use official provider as the effective runtime route until unofficial session stability is proven.

### Environment variables
Set on Vercel runtime:

- `FORCE_OFFICIAL_LINE=true` (hard switch all sends to official)
- `UNOFFICIAL_CANARY_ENABLED=false` (or unset)

### Result
- `messaging-service` still supports provider abstraction.
- Effective provider config resolves to official route for reliability.
- Existing fallback logic remains available.

## Canary re-enable procedure (later)
When unofficial endpoint is stable:

1. Set `FORCE_OFFICIAL_LINE=false` (or remove it)
2. Set `UNOFFICIAL_CANARY_ENABLED=true`
3. Set `messaging_primary_provider=unofficial_line` in bot settings
4. Keep `messaging_fallback_provider=official_line`
5. Validate via `/api/test-all?secret=...` and check provider routing section

## Operational checks
- Run `/api/test-all?secret=...` and confirm:
  - Provider line shows effective `primary/fallback`
  - LINE quota check passes (official path)
- Run `/api/smoke-test` and confirm success
- Run one live send from `/messages` page

## Notes
- Do not rely on unofficial token auth persistence from cloud/datacenter IPs.
- Keep official fallback enabled for all production periods.
