// Minimal xrpl.js adapter skeleton for server-side XRPL connectivity.
// Guardrails: does not persist or log private seeds. Server must inject XRPL_WALLET_SEED and RIPPLED_URL at runtime
// and mount owner-only endpoints that call into this adapter. This module intentionally avoids signing operations
// unless XRPL_WALLET_SEED is present in the environment at runtime. Do NOT commit seeds to the repo.

const EventEmitter = require('events');
let xrpl = null;
try { xrpl = require('xrpl'); } catch (e) { /* xrpl not installed yet — runtime will need `npm i xrpl` */ }

class XRPLClient extends EventEmitter{
  constructor(){
    super();
    this.client = null;
    this.wallet = null; // do not commit seed anywhere
    this.connected = false;
    this.lastLedger = null;
    this.cache = { status: null, ts:0 };
  }

  async init(){
    const url = process.env.RIPPLED_URL || process.env.XRPL_RIPPLED_URL;
    if(!url) {
      // no public node configured — adapter can still return basic status using env-held public address
      return;
    }
    if(!xrpl) {
      // xrpl not installed — throw to make it obvious at runtime
      throw new Error('xrpl library not installed. Run `npm install xrpl` in server environment.');
    }

    this.client = new xrpl.Client(url);
    try{
      await this.client.connect();
      this.connected = true;
      this.client.on('error', (err)=> this.emit('error', err));
      this.client.on('disconnected', ()=> { this.connected=false; this.emit('disconnected'); });
      this.client.on('connected', ()=> { this.connected=true; this.emit('connected'); });
    }catch(err){
      // leave disconnected — caller can implement retry/backoff
      this.connected = false;
      throw err;
    }

    // If a seed is provided at runtime (injected via secrets manager), derive a wallet but do not log the seed.
    const seed = process.env.XRPL_WALLET_SEED;
    if(seed){
      this.wallet = xrpl.Wallet.fromSeed(seed);
      // do not emit seed or log private material. Expose only public address.
    }
  }

  async disconnect(){
    if(this.client){
      try{ await this.client.disconnect(); }catch(e){}
      this.client = null;
      this.connected = false;
    }
  }

  // getStatus returns a sanitized status object suitable for owner-only endpoints
  async getStatus({force=false}={}){
    const now = Date.now();
    if(!force && this.cache.status && (now - this.cache.ts) < 3000) return this.cache.status; // short TTL cache

    const publicAddress = process.env.XRPL_WALLET_ADDRESS || (this.wallet && this.wallet.classicAddress) || null;
    const res = { address: publicAddress, connected: !!this.connected, lastSyncTs: new Date().toISOString(), network: process.env.XRPL_NETWORK || 'UNKNOWN' };

    if(this.client && publicAddress){
      try{
        const info = await this.client.request({ command: 'account_info', account: publicAddress });
        res.balanceDrops = info.result.account_data && info.result.account_data.Balance;
        if(res.balanceDrops) res.balanceXRP = (Number(res.balanceDrops) / 1000000).toString();
        res.lastLedger = info.result.ledger_index || null;
      }catch(err){
        // do not leak error internals to clients; emit for server logs and keep status minimal
        this.emit('error', err);
      }
    }

    this.cache = { status: res, ts: now };
    return res;
  }

  // subscribeAccountTx will subscribe to account_tx stream for the configured public address if client available
  async subscribeAccountTx(onEvent){
    const publicAddress = process.env.XRPL_WALLET_ADDRESS || (this.wallet && this.wallet.classicAddress);
    if(!this.client || !publicAddress) throw new Error('No rippled client or wallet address configured for subscription.');

    // xrpl.js uses websocket: use client.request to subscribe or client.on('ledger') depending on version
    try{
      // Example: use account_tx via request (server may need to implement ledger websocket handling)
      // Here we implement a simple poll fallback if no streaming API is present.
      // Implementers should replace with real websocket subscription for production.
      this._pollAccountTx(publicAddress, onEvent);
    }catch(err){
      this.emit('error', err);
    }
  }

  // naive poll fallback — implementers should prefer websocket subscription (account_tx stream)
  async _pollAccountTx(address, onEvent){
    let lastLedger = this.lastLedger || 0;
    const poll = async ()=>{
      try{
        const res = await this.client.request({ command: 'account_tx', account: address, ledger_index_min: -1, ledger_index_max: -1, binary: false, forward: false });
        const txs = (res.result && res.result.transactions) || [];
        // emit all txs to callback — server should dedupe/persist
        onEvent(txs.map(t => ({ ledger: t.tx.ledger_index, tx: t.tx })));
        if(res.result && res.result.transactions && res.result.transactions.length){
          lastLedger = res.result.transactions[0].tx.ledger_index || lastLedger;
          this.lastLedger = lastLedger;
        }
      }catch(e){
        // non-fatal — emit error for server logging
        this.emit('error', e);
      }
    };
    // run immediately then interval
    await poll();
    this._pollInterval = setInterval(poll, 10000);
  }

  stopPolling(){ if(this._pollInterval) clearInterval(this._pollInterval); }
}

module.exports = new XRPLClient();
