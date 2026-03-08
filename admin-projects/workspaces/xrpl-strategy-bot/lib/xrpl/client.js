'use strict';

// Minimal XRPL client adapter skeleton. Safe by default: simulates trades unless XRPL env vars and xrpl module are available.
// Exports: init(opts), getOrderbook(market), placeOrder({side,size,price,market,simulate})

const fs = require('fs');
const path = require('path');

let simulated = true;
let client = null;

module.exports = {
  init: async function init(opts = {}) {
    simulated = !!opts.simulate;
    // Attempt to require xrpl if not simulating and module exists
    if (!simulated) {
      try {
        const xrpl = require('xrpl');
        client = { xrpl };
      } catch (err) {
        console.warn('xrpl module not available; falling back to simulated mode');
        simulated = true;
      }
    }
    return { simulated };
  },

  getOrderbook: async function getOrderbook(market) {
    // market string like 'XAHAU/XRP' — for simulation we generate plausible values.
    if (simulated || !client) {
      // return a simple simulated orderbook around a price that drifts slowly (persist state locally)
      const stateFile = path.join(__dirname, '..', 'db', 'xrpl_price_state.json');
      let state = { price: 1.0 };
      try {
        if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      } catch (e) {}

      // random walk
      const change = (Math.random() - 0.5) * 0.02;
      state.price = Math.max(0.0001, state.price * (1 + change));
      try { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); } catch (e) {}

      const mid = state.price;
      const spread = mid * (0.002 + Math.random() * 0.003);
      const bestBid = mid - spread / 2;
      const bestAsk = mid + spread / 2;
      return { bestBid, bestAsk, bids: [[bestBid, 100]], asks: [[bestAsk, 100]], ts: new Date().toISOString() };
    }

    // Real XRPL orderbook fetch placeholder (not implemented fully here)
    // If you provide XRPL_WALLET_SEED and RIPPLED_URL and have xrpl installed, extend this section to query the ledger.
    throw new Error('Real XRPL orderbook fetch not implemented in this skeleton; falling back to simulated mode');
  },

  placeOrder: async function placeOrder(opts) {
    // opts: { side, size, price, market, simulate }
    if (opts.simulate || simulated || !client) {
      // simulate execution (immediate fill at price)
      return { simulated: true, status: 'filled', filledSize: opts.size, price: opts.price };
    }

    // Real submit path: not implemented to avoid embedding secrets in repo and to preserve owner-only runtime secret behavior.
    throw new Error('Real order submission path requires implementing xrpl signing & submission in a secrets-managed runtime');
  }
};
