# Personal XRPL Trading Bot (owner-only)

This workspace is an owner-only preview of a personal XRPL trading bot: a red/black themed dashboard, owner-guarded API endpoints, an XRPL adapter skeleton using xrpl.js, and a local DB for metrics and simulated trades.

What was added
- index.html, client.js, style.css: red & black themed dashboard UI
- server.js: Express API with owner authentication (x-owner-wallet header) and endpoints:
  - GET /api/admin/personal-bot/status
  - GET /api/admin/personal-bot/metrics
  - GET /api/admin/personal-bot/trades
  - POST /api/admin/personal-bot/poll
  - POST /api/admin/personal-bot/simulate-trade
- lib/xrpl/client.js: XRPL adapter skeleton (uses xrpl.js when RIPPLED_URL is configured at runtime)
- db/db.json: initial database file for metrics and trades
- package.json and .env.example
- cbot-project.json: workspace metadata

Security & guardrails
- DO NOT commit XRPL_WALLET_SEED or other secrets. Use the .env.example to configure runtime secrets via an external secret manager.
- The server enforces owner auth via the x-owner-wallet header and the OWNER_WALLETS environment variable. If OWNER_WALLETS is unset, the server logs a warning and allows access (set OWNER_WALLETS in production!).

Previewing the workspace
- This workspace is intended to be served under the owner-only admin projects hub. The static UI can be served by running the workspace server and/or by the main app proxying the workspace route.
- To run locally (owner-only preview):
  1. cd admin-projects/workspaces/personal-xrpl-bot
  2. npm install (installs express and xrpl)
  3. Set environment variables (see .env.example). Example:
     OWNER_WALLETS=rVeHp61gJ9MxoqMkAMmEbow8KYWk3AH1X RIPPLED_URL= w/ optional XRPL_WALLET_SEED set in your secret manager
  4. npm start
  5. Visit http://localhost:3001/index.html

Notes
- The XRPL adapter is read-only by default when RIPPLED_URL is provided. Signing/execution is only possible when XRPL_WALLET_SEED is provided at runtime and the code is extended to perform signing flows.
- The UI includes an owner wallet input used to set the x-owner-wallet header. This is intended for owner preview and must be guarded by server-side OWNER_WALLETS at runtime.

Next steps (owner-driven)
- Provide the wallet/seed via a secure runtime secret manager to enable signing (not stored in repo).
- Extend the strategy runner, add risk controls, trade logging and off-chain audits.

