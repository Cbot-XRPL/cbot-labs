// XRPL client adapter skeleton for server-side use
// - Reads RIPPLED_URL and XRPL_WALLET_SEED from environment at runtime (secrets must be injected externally)
// - Provides async functions: init(), getStatus(), getAccountTransactions(account, limit)

const xrpl = require('xrpl');

let client = null;
let wallet = null;
let connected = false;

async function init() {
  const url = process.env.RIPPLED_URL || null;
  if(!url) {
    // Nothing to init — optional config
    return;
  }
  client = new xrpl.Client(url);
  try {
    await client.connect();
    connected = true;
    const seed = process.env.XRPL_WALLET_SEED || null;
    if(seed) {
      try {
        wallet = xrpl.Wallet.fromSeed(seed);
      } catch (e) {
        console.warn('[xrpl-client] invalid XRPL_WALLET_SEED provided');
      }
    }
    // Keep client connected; caller can handle reconnection if needed
  } catch (err) {
    connected = false;
    client = null;
    throw err;
  }
}

async function getStatus() {
  // Returns a lightweight status object for the UI
  const res = {connected: connected, ledger_index: null, account: null, balances: {}};
  if(!connected || !client) return res;
  try {
    const ledger = await client.request({command: 'ledger', ledger_index: 'validated', transactions: false, expand: false});
    res.ledger_index = ledger.result.ledger.ledger_index;
  } catch (e) {
    // ignore
  }
  if(process.env.XRPL_ACCOUNT) {
    res.account = process.env.XRPL_ACCOUNT;
    try {
      const bal = await client.request({command: 'account_info', account: res.account, ledger_index: 'validated'});
      if(bal && bal.result && bal.result.account_data) {
        res.balances = {XRP: xrpl.dropsToXrp(bal.result.account_data.Balance)};
      }
    } catch (e) {
      // ignore
    }
  } else if(wallet) {
    res.account = wallet.address;
    try {
      const bal = await client.request({command: 'account_info', account: res.account, ledger_index: 'validated'});
      if(bal && bal.result && bal.result.account_data) {
        res.balances = {XRP: xrpl.dropsToXrp(bal.result.account_data.Balance)};
      }
    } catch (e) {}
  }

  // Provide a simple heuristic placeholder for liquidity (for UI convenience)
  res.liquidity_estimate = res.balances && res.balances.XRP && parseFloat(res.balances.XRP) > 100 ? 'healthy' : 'low';
  return res;
}

async function getAccountTransactions(account, limit = 10) {
  if(!connected || !client) return [];
  if(!account) return [];
  try {
    // Use account_tx to fetch recent transactions for the account
    const resp = await client.request({command: 'account_tx', account, ledger_index_min: -1, ledger_index_max: -1, binary: false, forward: false, limit});
    const txs = (resp.result && resp.result.transactions) || [];
    // Normalize the items a bit for the UI
    return txs.map(item => {
      const tx = item.tx || item;
      return {
        hash: tx.hash || tx.transaction_hash || null,
        type: tx.TransactionType || tx.type,
        date: tx.date || null,
        tx
      };
    });
  } catch (err) {
    console.warn('[xrpl-client] getAccountTransactions error:', err.message || err);
    return [];
  }
}

module.exports = {
  init,
  getStatus,
  getAccountTransactions
};
