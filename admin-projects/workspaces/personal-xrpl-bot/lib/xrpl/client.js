'use strict';
const xrpl = require('xrpl');

let client = null;
let connected = false;

async function init() {
  if (connected) return;
  const url = process.env.RIPPLED_URL;
  if (!url) {
    console.warn('RIPPLED_URL not set — XRPL adapter will operate in simulated/read-only mode.');
    return;
  }
  try {
    client = new xrpl.Client(url);
    await client.connect();
    connected = true;
    console.log('Connected to XRPL node:', url);
  } catch (err) {
    console.error('XRPL init error:', err);
    client = null;
    connected = false;
    throw err;
  }
}

async function getStatus() {
  if (!process.env.RIPPLED_URL || !client) {
    // simulated/read-only status
    return {
      mode: 'simulated',
      connected: false,
      message: 'RIPPLED_URL not configured; simulate-only mode'
    };
  }
  try {
    const fee = await client.getFee();
    const serverInfo = await client.request({ command: 'server_info' });
    return {
      mode: 'live',
      connected: true,
      fee,
      serverInfo: serverInfo.result && serverInfo.result.info ? serverInfo.result.info : serverInfo
    };
  } catch (err) {
    console.error('getStatus error', err);
    return { mode: 'error', error: String(err) };
  }
}

// pollSample: lightweight probes for a few ecosystem metrics (simulated placeholders for Xahau/Flare/EVM)
async function pollSample() {
  // Always include a timestamp
  const sample = { ts: new Date().toISOString() };

  // XRPL probe
  if (process.env.RIPPLED_URL && client) {
    try {
      const ledger = await client.request({ command: 'ledger', ledger_index: 'validated', full: false });
      sample.xrpl = {
        ledger_index: ledger.result.ledger_index,
        ledger_hash: ledger.result.ledger_hash
      };
    } catch (e) {
      sample.xrpl = { error: String(e) };
    }
  } else {
    sample.xrpl = { simulated: true, note: 'no RIPPLED_URL' };
  }

  // Xahau token placeholder (simulated) — real integration would query a gateway/orderbook
  sample.xahau = {
    token: 'XAHAU',
    price_estimate: (Math.random() * 0.5 + 0.5).toFixed(6),
    liquidity_note: 'simulated'
  };

  // Flare placeholder
  sample.flare = {
    token: 'FLR',
    price_estimate: (Math.random() * 0.5 + 0.2).toFixed(6),
    note: 'simulated'
  };

  // EVM sidechain placeholder
  sample.evm = {
    chain: 'Example-EVM',
    native_price_estimate: (Math.random() * 20 + 10).toFixed(4),
    note: 'simulated'
  };

  return sample;
}

module.exports = { init, getStatus, pollSample };
