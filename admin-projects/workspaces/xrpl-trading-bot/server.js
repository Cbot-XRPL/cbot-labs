// Simple owner-only Express server for the XRPL Trading Bot workspace
// Protects API and UI index route using OWNER_WALLETS and x-owner-wallet header.

const express = require('express');
const path = require('path');
const morgan = require('morgan');
const dotenv = require('dotenv');
const xrplClient = require('./lib/xrpl/client');

dotenv.config();

const OWNER_WALLETS = (process.env.OWNER_WALLETS || '').split(',').map(s => s.trim()).filter(Boolean);
const PORT = process.env.PORT || 4002;

const app = express();
app.use(morgan('tiny'));
app.use(express.json());

function requireOwner(req, res, next) {
  const header = (req.headers['x-owner-wallet'] || '').trim();
  if(!header || OWNER_WALLETS.length === 0 || !OWNER_WALLETS.includes(header)) {
    return res.status(401).json({error: 'unauthorized: missing or invalid x-owner-wallet header'});
  }
  next();
}

// Serve static assets (css/js) from workspace root if needed. Index HTML is served from protected route below.
app.use('/public', express.static(path.join(__dirname)));

// Protected UI route — returns index.html only to owners
app.get('/', requireOwner, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API endpoints: owner-authenticated
app.get('/api/admin/trading/status', requireOwner, async (req, res) => {
  try {
    const status = await xrplClient.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({error: String(err)});
  }
});

app.get('/api/admin/trading/txs', requireOwner, async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit || '10') || 10);
  try {
    const address = process.env.XRPL_ACCOUNT || null;
    if(!address) {
      // return empty list but not an error — the UI can still display placeholder
      return res.json({txs: []});
    }
    const txs = await xrplClient.getAccountTransactions(address, limit);
    res.json({txs});
  } catch (err) {
    res.status(500).json({error: String(err)});
  }
});

app.get('/api/admin/trading/metrics', requireOwner, async (req, res) => {
  try {
    // Combine real XRPL-derived metrics with simulated placeholders for other ecosystems.
    const xrplStatus = await xrplClient.getStatus();

    const metrics = {
      xrpl_liquidity: xrplStatus.liquidity_estimate || 'low',
      xah_flow: 'simulated: 120 token/hr',
      flare_activity: 'simulated: moderate',
      evm_tps: 'simulated: 34 tps',
      analysis_note: 'No actionable signals' // placeholder; agent brain will update when implemented
    };

    // Attach some XRPL-derived numeric indicators when available
    if(xrplStatus && xrplStatus.connected) {
      metrics.xrpl_liquidity = xrplStatus.ledger_index ? `ledger ${xrplStatus.ledger_index}` : 'connected';
    }

    res.json(metrics);
  } catch (err) {
    res.status(500).json({error: String(err)});
  }
});

// Simple health endpoint (not owner-restricted)
app.get('/health', (req, res) => res.json({ok: true, env: process.env.NODE_ENV || 'development'}));

// Initialize XRPL client (connect in background if configured)
xrplClient.init().catch(err => {
  console.warn('[xrpl-client] init failed (will retry on demand):', err.message || err);
});

app.listen(PORT, () => {
  console.log(`XRPL Trading Bot workspace listening on port ${PORT}`);
});
