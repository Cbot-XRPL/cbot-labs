const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const xrplClient = require('./lib/xrpl/client');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4060;
const DB_PATH = path.join(__dirname, 'db', 'db.json');

// Simple JSON DB helpers
function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { metrics: [], trades: [] };
  }
}
function writeDB(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Owner auth middleware: checks x-owner-wallet header against OWNER_WALLETS env var
function ownerAuth(req, res, next) {
  const header = req.header('x-owner-wallet');
  const allowed = (process.env.OWNER_WALLETS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.length) {
    // No configured owners: allow access but warn in logs (useful for local dev)
    console.warn('OWNER_WALLETS not set — endpoints currently allow access (recommended to set OWNER_WALLETS in runtime).');
    return next();
  }
  if (!header) return res.status(401).json({ error: 'x-owner-wallet header required' });
  if (!allowed.includes(header)) return res.status(403).json({ error: 'owner wallet not authorized' });
  next();
}

// Serve static UI files
app.use('/', express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// API endpoints (owner-only)
app.get('/api/admin/personal-bot/status', ownerAuth, async (req, res) => {
  try {
    await xrplClient.init();
    const status = await xrplClient.getStatus();
    return res.json({ ok: true, status });
  } catch (err) {
    console.error('status error', err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/api/admin/personal-bot/metrics', ownerAuth, (req, res) => {
  const db = readDB();
  res.json({ ok: true, metrics: db.metrics || [], trades: db.trades || [] });
});

// trigger a poll: fetch XRPL sample and record a metric
app.post('/api/admin/personal-bot/poll', ownerAuth, async (req, res) => {
  try {
    const sample = await xrplClient.pollSample();
    const db = readDB();
    db.metrics = db.metrics || [];
    db.metrics.unshift({ ts: new Date().toISOString(), sample });
    // keep recent 200 entries
    if (db.metrics.length > 200) db.metrics = db.metrics.slice(0, 200);
    writeDB(db);
    res.json({ ok: true, sample });
  } catch (err) {
    console.error('poll error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// simulate a trade (audit only) — small simulated trade persisted to DB
app.post('/api/admin/personal-bot/simulate-trade', ownerAuth, (req, res) => {
  try {
    const { side = 'buy', token = 'XRP', size } = req.body || {};
    const tradeSize = Number(size || process.env.TRADE_SIZE || 1);
    const trade = {
      id: 'sim-' + Date.now(),
      ts: new Date().toISOString(),
      side,
      token,
      size: tradeSize,
      note: 'simulated trade — no funds moved'
    };
    const db = readDB();
    db.trades = db.trades || [];
    db.trades.unshift(trade);
    if (db.trades.length > 500) db.trades = db.trades.slice(0, 500);
    writeDB(db);
    res.json({ ok: true, trade });
  } catch (err) {
    console.error('simulate-trade error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Personal XRPL Bot workspace running on port ${PORT}`);
});
