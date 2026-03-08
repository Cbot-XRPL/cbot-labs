XRPL Trading Bot — Strategies Watch UI

This subproject provides an owner-only, read-only observability UI for XRPL trading strategies.

What is included:
- strategies.html — web UI that lists strategies and runs a local simulation to produce demo signals.
- strategies-client.js — client side code (simulation / rendering).
- strategies.json — canonical list of strategies with triggers, sizing, and prerequisites.

Important guardrails:
- This UI is read-only and performs no signing or on-ledger transactions.
- Do not store seeds in the repo. To run strategies in automation, wire a server-side adapter in lib/xrpl/ and provide seeds via secret manager (XRPL_WALLET_SEED) only.
- Add OWNER_WALLETS and mount routes under owner-only APIs before enabling any automated execution.

Server integration hints:
- A small helper module is provided at lib/xrpl/strategies.js to read the strategies catalog from the repo. Use that module to expose endpoints such as /api/admin/trading/strategies and /api/admin/trading/sim.

