const express = require("express");
const fs = require("fs");
const path = require("path");
const xrplClient = require("../lib/xrpl/client");

const router = express.Router();
const workspaceDbPath = path.join(__dirname, "..", "admin-projects", "workspaces", "personal-xrpl-bot", "db", "db.json");

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(workspaceDbPath, "utf8"));
  } catch (_error) {
    return { metrics: [], trades: [] };
  }
}

function writeDb(value) {
  fs.mkdirSync(path.dirname(workspaceDbPath), { recursive: true });
  fs.writeFileSync(workspaceDbPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function getSafeStatus() {
  try {
    const status = await xrplClient.getStatus();
    if (!status?.error) {
      return status;
    }
  } catch (_error) {
    // Fall through to simulated status for local preview.
  }

  return {
    mode: "simulated",
    connected: false,
    online: false,
    address: String(process.env.XRPL_WALLET_ADDRESS || "").trim() || null,
    message: "XRPL client unavailable in local preview mode"
  };
}

async function buildPollSample() {
  const status = await getSafeStatus();
  const sample = {
    ts: new Date().toISOString(),
    xrpl: {
      connected: Boolean(status.connected),
      online: Boolean(status.online),
      address: status.address || null,
      ledger_index: status.ledgerIndex ?? null,
      note: status.error || status.message || null
    },
    xahau: {
      token: "XAHAU",
      price_estimate: (Math.random() * 0.5 + 0.5).toFixed(6),
      liquidity_note: "simulated"
    },
    flare: {
      token: "FLR",
      price_estimate: (Math.random() * 0.5 + 0.2).toFixed(6),
      note: "simulated"
    },
    evm: {
      chain: "Example-EVM",
      native_price_estimate: (Math.random() * 20 + 10).toFixed(4),
      note: "simulated"
    }
  };

  return sample;
}

router.get("/status", async (_req, res) => {
  try {
    const status = await getSafeStatus();
    res.json({ ok: true, status });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Unable to load personal bot status"
    });
  }
});

router.get("/metrics", (_req, res) => {
  const db = readDb();
  res.json({
    ok: true,
    metrics: Array.isArray(db.metrics) ? db.metrics : [],
    trades: Array.isArray(db.trades) ? db.trades : []
  });
});

router.post("/poll", async (_req, res) => {
  try {
    const sample = await buildPollSample();
    const db = readDb();
    db.metrics = Array.isArray(db.metrics) ? db.metrics : [];
    db.metrics.unshift({ ts: new Date().toISOString(), sample });
    db.metrics = db.metrics.slice(0, 200);
    writeDb(db);
    res.json({ ok: true, sample });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Unable to record personal bot poll sample"
    });
  }
});

router.post("/simulate-trade", (req, res) => {
  try {
    const payload = req.body || {};
    const trade = {
      id: `sim-${Date.now()}`,
      ts: new Date().toISOString(),
      side: String(payload.side || "buy"),
      token: String(payload.token || "XRP"),
      size: Number(payload.size || process.env.TRADE_SIZE || 1),
      price: payload.price == null ? null : Number(payload.price),
      note: String(payload.note || "simulated trade - no funds moved")
    };

    const db = readDb();
    db.trades = Array.isArray(db.trades) ? db.trades : [];
    db.trades.unshift(trade);
    db.trades = db.trades.slice(0, 500);
    writeDb(db);
    res.json({ ok: true, trade });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Unable to record simulated trade"
    });
  }
});

module.exports = router;
