// Registerable routes for admin XRPL trading endpoints.
// This module exports a function so server.js can inject ownerAuth middleware from existing app auth.

const express = require('express');
const xrplClient = require('../../lib/xrpl/client');

module.exports = function registerTradingRoutes(app, ownerAuth) {
  const router = express.Router();

  // Protect routes with provided ownerAuth middleware if available.
  // If ownerAuth is not provided, apply a conservative header-based check using OWNER_WALLETS env var.
  const fallbackAuth = (req, res, next) => {
    const owners = (process.env.OWNER_WALLETS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (owners.length === 0) {
      return res.status(403).json({ error: 'Owner authentication not configured on server.' });
    }
    // Very small fallback: require x-owner-wallet header to match an owner address.
    const header = req.headers['x-owner-wallet'];
    if (!header || !owners.includes(header)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };

  const protect = ownerAuth || fallbackAuth;

  // GET /api/admin/trading/status
  router.get('/status', protect, async (req, res) => {
    try {
      const status = await xrplClient.getStatus();
      let balance = null;
      if (status.address && status.online) {
        try {
          balance = await xrplClient.getBalance();
        } catch (err) {
          // Non-fatal: return status with null balance and an error hint
          return res.json({ online: status.online, address: status.address, balance: null, error: String(err.message || err) });
        }
      }
      res.json({ online: status.online, address: status.address, balance });
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  // Placeholder endpoints; implement as needed server-side if you want transactions/metrics
  router.get('/txs', protect, (req, res) => {
    res.json({ txs: [], note: 'Server tx listing not implemented in skeleton.' });
  });

  router.get('/metrics', protect, (req, res) => {
    res.json({ metrics: {}, note: 'Server metrics not implemented in skeleton.' });
  });

  app.use('/api/admin/trading', router);
};
