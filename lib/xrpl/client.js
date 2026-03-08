'use strict';

// XRPL client adapter skeleton for server-side usage.
// - Reads XRPL_WALLET_SEED and RIPPLED_URL from environment variables at runtime.
// - Does NOT store or expose secrets in the repo.
// - Exports init(), getStatus(), getBalance().

const xrpl = require('xrpl');

let client = null;
let wallet = null;
let connected = false;

async function init() {
  const url = process.env.RIPPLED_URL || 'wss://s1.ripple.com';
  const seed = process.env.XRPL_WALLET_SEED;

  if (!seed) {
    // Wallet not configured; keep client null and report disconnected.
    console.warn('XRPL client not initialized: XRPL_WALLET_SEED is not set in environment.');
    connected = false;
    return;
  }

  client = new xrpl.Client(url);
  try {
    await client.connect();
    // Build wallet from seed at runtime (seed must be provided via secure env/secrets manager)
    wallet = xrpl.Wallet.fromSeed(seed);
    connected = true;
  } catch (err) {
    console.error('Failed to init XRPL client:', err && err.message ? err.message : err);
    connected = false;
  }
}

async function ensureClient() {
  if (!client) await init();
  return client && connected;
}

async function getBalance() {
  // Returns { xrp: '0.0', drops: '0' } or throws if not configured
  if (!process.env.XRPL_WALLET_SEED) {
    throw new Error('XRPL wallet not configured (XRPL_WALLET_SEED missing)');
  }
  const ok = await ensureClient();
  if (!ok) throw new Error('XRPL client not connected');

  try {
    const acct = wallet.classicAddress;
    const resp = await client.request({
      command: 'account_info',
      account: acct,
      ledger_index: 'validated'
    });
    const drops = resp.result.account_data.Balance; // string in drops
    const xrp = (Number(drops) / 1_000_000).toString();
    return { xrp, drops };
  } catch (err) {
    throw new Error('Failed to fetch balance: ' + (err && err.message ? err.message : err));
  }
}

async function getStatus() {
  // Returns { online: bool, address: string | null }
  if (!process.env.XRPL_WALLET_SEED) return { online: false, address: null };
  await ensureClient();
  const address = wallet ? wallet.classicAddress : null;
  return { online: Boolean(connected), address };
}

module.exports = {
  init,
  getStatus,
  getBalance
};
