# XRPL Strategy Bot (owner-only)

This workspace provides a minimal owner-only XRPL strategy runner and monitoring UI.

Key points:
- Owner authentication is enforced by checking x-owner-wallet header against OWNER_WALLETS env var.
- By default the bot simulates trades and logs them to db/db.json. To enable real signing/submission, set XRPL_WALLET_SEED and RIPPLED_URL in your secret manager (do NOT store them in repo).
- Polling interval and basic strategy parameters can be changed via env variables.

Quick start (inside project folder):

1. Install dependencies:
   npm install

2. Configure environment (use a secrets manager / .env in runtime only):
   Copy .env.example to your runtime env and set secrets as needed.

3. Start the app:
   npm start

Routes (owner-only, require x-owner-wallet header set to one of OWNER_WALLETS):
- GET /api/admin/strategies/status - current strategy status & last tick
- GET /api/admin/strategies/metrics - metrics & aggregates
- POST /api/admin/strategies/trigger - run one tick immediately (returns result)
- GET /api/admin/strategies/trades - list persisted trades

UI: visit / (dashboard) after starting the server.

Notes:
- All sensitive secrets must be set in runtime environment; no secrets are stored in the repository.
- The included strategy is deliberately small/simple (SMA crossover on mid-price) to allow learning and observation. Adjust carefully and prefer audits.
