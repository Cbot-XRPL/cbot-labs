# Personal XRPL Trading Bot (owner-only)

This workspace provides an owner-only dashboard and a lightweight XRPL adapter skeleton.

Files of interest:
- index.html, client.js, style.css — red/black themed dashboard UI
- server.js — Express server with owner-guarded APIs
- lib/xrpl/client.js — XRPL adapter skeleton using xrpl.js
- db/db.json — local JSON DB for metrics and simulated trades
- .env.example — runtime environment variables (do not store secrets in repo)

Owner usage:
1. Configure OWNER_WALLETS (comma-separated) in your runtime environment and optionally RIPPLED_URL and XRPL_WALLET_SEED in a secure secret manager.
2. From the project workspace, run npm install and npm start (or use preview via main app routes if available).
3. Open the owner-only hub link: /admin/projects/workspaces/personal-xrpl-bot/

Notes:
- The adapter will only attempt to connect to XRPL if RIPPLED_URL is provided at runtime.
- XRPL_WALLET_SEED must never be committed to the repository. Use secrets manager or runtime environment injection.
