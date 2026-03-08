'use strict';

// XRPL client adapter for server-side use.
// Reads XRPL_WALLET_ADDRESS, XRPL_WALLET_SEED and RIPPLED_URL from environment at runtime.
// Does NOT log or persist secrets.

const xrpl = require('xrpl');

let client = null;
let connected = false;
let configuredAddress = process.env.XRPL_WALLET_ADDRESS || null;

async function init() {
  if (client && connected) return { connected };
  const url = process.env.RIPPLED_URL;
  if (!url) {
    throw new Error('RIPPLED_URL environment variable not set');
  }
  client = new xrpl.Client(url);
  try {
    await client.connect();
    connected = true;
    return { connected };
  } catch (err) {
    connected = false;
    throw err;
  }
}

async function getStatus() {
  if (!client || !connected) {
    try {
      await init();
    } catch (err) {
      return {
        connected: false,
        error: String(err),
      };
    }
  }

  if (!configuredAddress) {
    return {
      connected: true,
      address: null,
      balance: null,
      msg: 'XRPL_WALLET_ADDRESS not configured in environment',
    };
  }

  try {
    // Use account_info to fetch balance (in drops)
    const resp = await client.request({
      command: 'account_info',
      account: configuredAddress,
      ledger_index: 'validated',
    });
    const accountData = resp.result.account_data || {};
    const balanceDrops = accountData.Balance || accountData.balance || '0';
    // Balance is string drops; convert to XRP
    const balanceXRP = (BigInt(balanceDrops) / BigInt(1000000)).toString();
    // For fractional XRP, compute decimal string
    const drops = BigInt(balanceDrops);
    const whole = drops / BigInt(1000000);
    const rem = drops % BigInt(1000000);
    const remStr = rem.toString().padStart(6, '0').replace(/0+$/,'');
    const balanceStr = remStr === '' ? whole.toString() : `${whole.toString()}.${remStr}`;

    return {
      connected: true,
      address: configuredAddress,
      balanceXRP: balanceStr,
      ledgerIndex: resp.result.ledger_index || null,
    };
  } catch (err) {
    return {
      connected: true,
      address: configuredAddress,
      balance: null,
      error: String(err),
    };
  }
}

async function getAccountTxs(limit = 10) {
  if (!client || !connected) {
    await init();
  }
  if (!configuredAddress) return [];
  try {
    // Use account_tx (may require rippled with this command enabled)
    const resp = await client.request({
      command: 'account_tx',
      account: configuredAddress,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: Number(limit) || 10,
    });
    const txs = (resp.result.transactions || []).map(t => ({
      hash: t.tx?.hash || t.hash || null,
      date: t.date || null,
      meta: t.meta || null,
      tx: t.tx || null,
    }));
    return txs;
  } catch (err) {
    // account_tx may not be available on some servers; return error information
    return { error: String(err) };
  }
}

module.exports = {
  init,
  getStatus,
  getAccountTxs,
};
