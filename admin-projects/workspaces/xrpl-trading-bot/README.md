# XRPL Trading Bot — Workspace

Owner-only observability UI and server skeleton for an experimental XRPL trading agent. The workspace provides:

- Owner-authenticated UI (red/black theme) to observe metrics across XRPL, Xahau, Flare, and an EVM sidechain.
- Server endpoints protected by owner whitelist via the x-owner-wallet request header.
- A server-side XRPL client adapter skeleton that connects to RIPPLED_URL and can use XRPL_WALLET_SEED at runtime (seeds are out-of-repo).

Quick start (developer):

1. Copy environment variables into a secure place or secrets manager. Do NOT commit your .env with secrets.
2. From this workspace root:
   - npm install
   - npm start
3. Send requests with header: x-owner-wallet: <one-of-owner-addresses>

API endpoints (owner-auth required):
- GET /               -> returns the protected UI (index.html)
- GET /api/admin/trading/status -> XRPL + token balance status
- GET /api/admin/trading/txs?limit=10 -> recent XRPL account transactions (when configured)
- GET /api/admin/trading/metrics -> aggregated metrics across tracked ecosystems

Notes:
- This workspace intentionally provides placeholder & simulated metrics for non-XRPL ecosystems. Integrations for Flare/EVM/Xahau can be expanded server-side without changing the UI surface.
- Never store XRPL_WALLET_SEED or other secrets in the repo. Provide them at runtime via your secret mechanism.

