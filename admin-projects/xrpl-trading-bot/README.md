# XRPL Trading Bot — Owner Dashboard

This mini-project provides an owner-only dashboard to show the configured XRPL wallet connection and balance. Per workspace guardrails, no secrets (wallet seeds) are stored in the repository.

Runtime requirements (set these in your secrets manager or environment variables):

- XRPL_WALLET_SEED - the wallet seed for the XRPL account (KEEP THIS SECRET; do NOT store in repo)
- RIPPLED_URL - optional WebSocket URL for rippled (defaults to wss://s1.ripple.com)
- OWNER_WALLETS - comma-separated list of owner wallet addresses allowed to access the admin endpoints (server auth middleware uses this)

How it works:

- lib/xrpl/client.js reads XRPL_WALLET_SEED and RIPPLED_URL at runtime and exposes getStatus() and getBalance().
- The dashboard (index.html + client.js) calls an owner-only endpoint at GET /api/admin/trading/status to fetch online/balance info.
- The server must expose the endpoints under /api/admin/trading/* behind owner authentication. A sample server.js is included in the repo to bootstrap this.

IMPORTANT: Do not put seeds or other secrets into the repo. Manage them via environment variables or your secret manager when running the server.
