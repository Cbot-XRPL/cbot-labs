'use strict';

const express = require('express');
const router = express.Router();
const xrplClient = require('../../lib/xrpl/client');

// Owner-only middleware
function ownerAuth(req, res, next) {
  // OWNER_WALLETS env should be a comma-separated list of public addresses.
  const header = req.header('x-owner-wallet') || req.query['x-owner-wallet'];
  const ownerList = (process.env.OWNER_WALLETS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!ownerList.length) {
    // If OWNER_WALLETS is not configured, deny access for safety
    return res.status(403).json({ error: 'Owner access not configured on server' });
  }
  if (!header) return res.status(401).json({ error: 'Missing x-owner-wallet header' });
  if (!ownerList.includes(header)) return res.status(403).json({ error: 'Unauthorized owner wallet' });
  // Proceed
  next();
}

// Health / status: returns connection status and wallet balance (public address only)
router.get('/api/admin/trading/status', ownerAuth, async (req, res) => {
  try {
    const status = await xrplClient.getStatus();
    // Never return/echo seeds or private info.
    res.json({ ok: true, timestamp: new Date().toISOString(), status });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Recent account transactions (best-effort). Query param: limit
router.get('/api/admin/trading/txs', ownerAuth, async (req, res) => {
  const limit = parseInt(req.query.limit || '10', 10);
  try {
    const txs = await xrplClient.getAccountTxs(limit);
    res.json({ ok: true, txs });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Basic metrics placeholder
router.get('/api/admin/trading/metrics', ownerAuth, async (req, res) => {
  try {
    const status = await xrplClient.getStatus();
    const metrics = {
      connected: !!status.connected,
      address: status.address || null,
      balanceXRP: status.balanceXRP || null,
      ledgerIndex: status.ledgerIndex || null,
    };
    res.json({ ok: true, metrics });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

module.exports = router;
