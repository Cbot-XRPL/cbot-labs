// Minimal server bootstrap for owner-only admin APIs and XRPL adapter.
// This file is intentionally conservative: it expects secrets (XRPL_WALLET_SEED, OWNER_WALLETS) to be provided via environment variables.
// It exposes owner-only endpoints under /api/admin/trading and serves admin-projects statically (owner should place auth in front of server in production).

const express = require('express');
const path = require('path');
const xrplClient = require('./lib/xrpl/client');
const registerTradingRoutes = require('./routes/admin/trading');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic ownerAuth example: if your existing server has a richer auth system, replace this with the real middleware.
// This simple middleware checks an incoming header 'x-owner-wallet' against OWNER_WALLETS env var.
function ownerAuth(req, res, next) {
  const owners = (process.env.OWNER_WALLETS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (owners.length === 0) {
    return res.status(403).json({ error: 'Server owner whitelist not configured (OWNER_WALLETS).' });
  }
  const incoming = req.headers['x-owner-wallet'];
  if (!incoming || !owners.includes(incoming)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Initialize XRPL client at startup (if seed exists in env)
xrplClient.init().catch(err => {
  console.warn('XRPL client init error (continuing):', err && err.message ? err.message : err);
});

// Register routes, passing ownerAuth middleware so guardrails are preserved.
registerTradingRoutes(app, ownerAuth);

// Serve admin-projects static files under /admin-projects (owner-only expected in front of this server)
app.use('/admin-projects/xrpl-trading-bot', express.static(path.join(__dirname, 'admin-projects', 'xrpl-trading-bot')));

app.get('/', (req, res) => {
  res.send('Cbot Labs Admin Server: XRPL trading endpoints mounted under /api/admin/trading.');
});

app.listen(PORT, () => {
  console.log(`Admin server running on port ${PORT}`);
});
