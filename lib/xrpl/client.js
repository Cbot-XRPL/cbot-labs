const fs = require("fs");
const path = require("path");

let xrplModule = null;
let xrplModuleChecked = false;
let client = null;

function getXrpl() {
  if (xrplModuleChecked) {
    return xrplModule;
  }

  xrplModuleChecked = true;
  try {
    xrplModule = require("xrpl");
  } catch (_error) {
    xrplModule = null;
  }

  return xrplModule;
}

function getDefaultAddress() {
  const configured = String(process.env.XRPL_WALLET_ADDRESS || "").trim();
  if (configured) {
    return configured;
  }

  const tomlPath = path.join(__dirname, "..", "..", ".well-known", "xahau.toml");
  try {
    const toml = fs.readFileSync(tomlPath, "utf8");
    const match = toml.match(/^address\s*=\s*"([^"]+)"/m);
    return match ? match[1] : "";
  } catch (_error) {
    return "";
  }
}

async function init() {
  const xrpl = getXrpl();
  if (!xrpl) {
    throw new Error("xrpl package is not installed");
  }

  if (client?.isConnected?.()) {
    return client;
  }

  const url = process.env.RIPPLED_URL || "wss://s1.ripple.com";
  client = new xrpl.Client(url);
  await client.connect();
  return client;
}

async function getStatus() {
  const address = getDefaultAddress();
  if (!address) {
    return {
      address: null,
      connected: false,
      online: false,
      balance: null,
      error: "XRPL_WALLET_ADDRESS not configured"
    };
  }

  try {
    const activeClient = await init();
    const response = await activeClient.request({
      command: "account_info",
      account: address,
      ledger_index: "validated"
    });
    const accountData = response?.result?.account_data;

    if (!accountData) {
      return {
        address,
        connected: true,
        online: true,
        balance: null
      };
    }

    return {
      address,
      connected: true,
      online: true,
      balance: Number(accountData.Balance || 0) / 1000000,
      sequence: accountData.Sequence || null,
      ledgerIndex: response?.result?.ledger_index || accountData.LedgerIndex || null
    };
  } catch (error) {
    return {
      address,
      connected: false,
      online: false,
      balance: null,
      error: error.message || "Unable to query XRPL status"
    };
  }
}

async function getRecentTxs(limit = 20) {
  const address = getDefaultAddress();
  if (!address) {
    throw new Error("XRPL_WALLET_ADDRESS not configured");
  }

  const activeClient = await init();
  const response = await activeClient.request({
    command: "account_tx",
    account: address,
    ledger_index_min: -1,
    ledger_index_max: -1,
    binary: false,
    limit: Math.min(100, Math.max(1, Number(limit) || 20))
  });

  return ((response?.result?.transactions) || []).map((entry) => {
    const tx = entry.tx || entry;
    return {
      hash: tx.hash || tx.TransactionHash || null,
      type: tx.TransactionType || null,
      date: tx.date || null,
      ledger_index: tx.ledger_index || tx.LedgerIndex || null,
      meta: entry.meta || tx.meta || {}
    };
  });
}

async function getAccountTxs(limit = 20) {
  return getRecentTxs(limit);
}

module.exports = {
  init,
  getStatus,
  getRecentTxs,
  getAccountTxs
};
