# XRPL Trading Bot — Owner-Only Admin Project

This folder contains an owner-only, observation-only dashboard for the personal XRPL trading bot. It is read-only in the browser: no private seeds or signing functionality are present client-side.

Files:
- index.html — owner-only UI skeleton (red/black theme)
- client.js — minimal client wiring to owner-only server endpoints
- style.css — red & black theme styles

Server endpoints expected (owner-only, must be implemented and protected by existing owner authentication):
- GET /api/admin/trading/status -> { address, balanceDrops, balanceXRP, lastLedger, connected, lastSyncTs, network, snapshotId }
- GET /api/admin/trading/txs?limit= -> { txs: [...] }
- GET /api/admin/trading/metrics -> { xahau: {...}, flare: {...}, evm: {...} }

Server-side responsibilities and guardrails:
- Load XRPL_WALLET_SEED and RIPPLED_URL from secret manager at runtime. Never commit seeds into repo.
- Expose sanitized owner-only endpoints listed above. Preserve existing owner auth/whitelist logic when mounting routes.
- Persist append-only snapshots to external SNAPSHOT_STORAGE for audit/replay. Do not write secrets into snapshots.

Developer notes:
- This commit includes a minimal server-side xrpl client adapter skeleton at lib/xrpl/client.js. Install xrpl.js in server environment (npm install xrpl) and wire the adapter in your server to provide the endpoints.
- For development use XRPL Testnet and ensure owner-only access before exposing these pages.
