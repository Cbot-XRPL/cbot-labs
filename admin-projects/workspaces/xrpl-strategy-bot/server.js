'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const xrplClient = require('./lib/xrpl/client');

const APP_ROOT = __dirname;
const DB_PATH = path.join(APP_ROOT, 'db', 'db.json');
const PORT = process.env.PORT || process.env.PORT || 4002;
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || process.env.POLL_INTERVAL || 30) * 1000;
const OWNER_WALLETS = (process.env.OWNER_WALLETS || '').split(',').map(s => s.trim()).filter(Boolean);
const MARKET = process.env.MARKET || 'XAHAU/XRP';
const TRADE_SIZE = Number(process.env.TRADE_SIZE || 0.1);
const SIMULATE = (process.env.SIMULATE || 'true') === 'true' || !process.env.XRPL_WALLET_SEED || !process.env.RIPPLED_URL;

// Ensure DB dir
function ensureDb() {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ trades: [], metrics: { ticks: 0 }, positions: [] }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(obj) {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(obj, null, 2));
}

function ownerAuth(req, res, next) {
  const owner = (req.header('x-owner-wallet') || '').trim();
  if (!owner || OWNER_WALLETS.length === 0 || !OWNER_WALLETS.includes(owner)) {
    return res.status(403).json({ error: 'owner-only: missing or unauthorized x-owner-wallet header' });
  }
  req.owner = owner;
  next();
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Owner-only API
app.get('/api/admin/strategies/status', ownerAuth, async (req, res) => {
  const db = readDb();
  const status = {
    market: MARKET,
    simulate: SIMULATE,
    lastTick: db.metrics.lastTick || null,
    positions: db.positions || [],
    lastTrades: (db.trades || []).slice(-10).reverse(),
    metrics: db.metrics || {}
  };
  res.json({ ok: true, status });
});

app.get('/api/admin/strategies/metrics', ownerAuth, async (req, res) => {
  const db = readDb();
  res.json({ ok: true, metrics: db.metrics || {} });
});

app.get('/api/admin/strategies/trades', ownerAuth, async (req, res) => {
  const db = readDb();
  res.json({ ok: true, trades: db.trades || [] });
});

app.post('/api/admin/strategies/trigger', ownerAuth, async (req, res) => {
  try {
    const result = await runStrategyTick();
    res.json({ ok: true, result });
  } catch (err) {
    console.error('trigger error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Basic in-process poller
let polling = false;
async function runStrategyTick() {
  // fetch orderbook / price
  const book = await xrplClient.getOrderbook(MARKET);
  const mid = (book.bestBid + book.bestAsk) / 2;

  // persistence
  const db = readDb();
  db.metrics = db.metrics || { ticks: 0 };
  db.metrics.ticks = (db.metrics.ticks || 0) + 1;
  db.metrics.lastTick = new Date().toISOString();
  db.metrics.lastMid = mid;
  db.metrics.history = db.metrics.history || [];
  db.metrics.history.push({ ts: new Date().toISOString(), mid, bestBid: book.bestBid, bestAsk: book.bestAsk });
  // Keep history reasonably small
  if (db.metrics.history.length > 500) db.metrics.history.shift();

  // Simple SMA strategy on mid price
  db.metrics.window = db.metrics.window || [];
  db.metrics.window.push(mid);
  if (db.metrics.window.length > 10) db.metrics.window.shift();
  const smaShort = average(db.metrics.window.slice(-3));
  const smaLong = average(db.metrics.window);

  let action = 'hold';
  let tradeRecord = null;

  // Very conservative rule: buy when short SMA crosses above long SMA, sell when reverse.
  const lastPos = (db.positions && db.positions.length > 0) ? db.positions[db.positions.length - 1] : null;
  const inPosition = !!lastPos && lastPos.side === 'buy' && !lastPos.closed;

  if (smaShort && smaLong) {
    if (smaShort > smaLong * 1.0001 && !inPosition) {
      action = 'enter_long';
      tradeRecord = await executeTrade('buy', TRADE_SIZE, mid, { simulated: SIMULATE });
    } else if (smaShort < smaLong * 0.9999 && inPosition) {
      action = 'exit_long';
      tradeRecord = await executeTrade('sell', TRADE_SIZE, mid, { simulated: SIMULATE });
    }
  }

  if (tradeRecord) {
    db.trades = db.trades || [];
    db.trades.push(tradeRecord);
    // manage positions
    db.positions = db.positions || [];
    if (tradeRecord.side === 'buy') {
      db.positions.push({ side: 'buy', size: tradeRecord.size, price: tradeRecord.price, ts: tradeRecord.ts, closed: false, tradeId: tradeRecord.id });
    } else if (tradeRecord.side === 'sell') {
      // close last open buy
      const open = db.positions && db.positions.slice().reverse().find(p => p.side === 'buy' && !p.closed);
      if (open) open.closed = true;
    }
  }

  writeDb(db);

  return { action, trade: tradeRecord, smaShort, smaLong, mid };
}

async function executeTrade(side, size, price, opts) {
  // Place trade via xrplClient; will simulate unless real config present
  const ts = new Date().toISOString();
  const id = `trade_${Date.now()}`;
  try {
    const resp = await xrplClient.placeOrder({ side, size, price, market: MARKET, simulate: SIMULATE });
    return Object.assign({ id, ts, side, size, price, market: MARKET }, resp);
  } catch (err) {
    console.error('executeTrade error', err);
    return { id, ts, side, size, price, market: MARKET, error: String(err) };
  }
}

function average(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// Poll loop
async function startPoller() {
  if (polling) return;
  polling = true;
  console.log('Strategy poller starting, interval:', POLL_INTERVAL);
  while (polling) {
    try {
      await runStrategyTick();
    } catch (err) {
      console.error('poll tick error', err);
    }
    await sleep(POLL_INTERVAL);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Startup
ensureDb();
(async () => {
  // init xrpl client adapter (may be simulated)
  try {
    await xrplClient.init({ simulate: SIMULATE, rippLedUrl: process.env.RIPPLED_URL, seed: process.env.XRPL_WALLET_SEED });
  } catch (err) {
    console.warn('xrpl client init warning:', String(err));
  }

  app.listen(PORT, () => {
    console.log('XRPL Strategy Bot listening on', PORT);
    // start poller in background
    startPoller().catch(e => console.error(e));
  });
})();

// static fallback index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
