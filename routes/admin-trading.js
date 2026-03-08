const express = require("express");
const xrplClient = require("../lib/xrpl/client");

const router = express.Router();

router.get("/status", async (_req, res) => {
  try {
    const status = await xrplClient.getStatus();
    const ok = !status.error;
    res.status(ok ? 200 : 503).json({
      ok,
      status,
      error: status.error || null
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Unable to load trading status"
    });
  }
});

router.get("/txs", async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const txs = await xrplClient.getRecentTxs(limit);
    res.json({ ok: true, txs });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Unable to load recent transactions"
    });
  }
});

router.get("/metrics", async (_req, res) => {
  try {
    const status = await xrplClient.getStatus();
    res.json({
      ok: !status.error,
      metrics: {
        connected: Boolean(status.connected),
        online: Boolean(status.online),
        address: status.address || null,
        balanceXRP: status.balance ?? null,
        ledgerIndex: status.ledgerIndex ?? null
      },
      error: status.error || null
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Unable to load trading metrics"
    });
  }
});

module.exports = router;
