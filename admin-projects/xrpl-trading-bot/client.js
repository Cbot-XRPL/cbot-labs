(function(){
  const ownerKey = 'xrpl_admin_owner_wallet';

  function $(id){return document.getElementById(id)}

  function getOwner() {
    return sessionStorage.getItem(ownerKey) || '';
  }
  function setOwner(v){ sessionStorage.setItem(ownerKey, v); }

  function authHeaders() {
    const owner = getOwner();
    return owner ? { 'x-owner-wallet': owner } : {};
  }

  async function fetchStatus(){
    const res = await fetch('/api/admin/trading/status', {
      method: 'GET',
      headers: Object.assign({ 'Accept': 'application/json' }, authHeaders())
    });
    return res.json();
  }

  async function fetchTxs(){
    const res = await fetch('/api/admin/trading/txs?limit=25', {
      method: 'GET',
      headers: Object.assign({ 'Accept': 'application/json' }, authHeaders())
    });
    return res.json();
  }

  function renderStatus(data){
    const out = $('conn-output');
    if (!data || !data.ok) {
      out.textContent = 'Offline or unauthorized: ' + (data && data.error ? data.error : 'no response');
      $('balance-output').textContent = '—';
      return;
    }
    const s = data.status;
    out.innerHTML = `<div><strong>Address:</strong> ${s.address}</div><div><strong>Ledger:</strong> ${s.ledgerIndex || s.ledgerIndex}</div>`;
    $('balance-output').textContent = (s.balance !== null && s.balance !== undefined) ? (s.balance + ' XRP') : 'unknown';
  }

  function renderTxs(data){
    const list = $('tx-list');
    list.innerHTML = '';
    if (!data || !data.ok) {
      list.innerHTML = '<li>Unable to load txs: ' + (data && data.error ? data.error : 'no response') + '</li>';
      return;
    }
    data.txs.forEach(tx => {
      const li = document.createElement('li');
      li.textContent = `${tx.type} — ${tx.hash || tx.TransactionHash || 'unknown'} — ledger ${tx.ledger_index || tx.LedgerIndex || 'n/a'}`;
      list.appendChild(li);
    });
  }

  // Bind UI
  $('save-owner').addEventListener('click', ()=>{
    const val = $('owner-wallet-input').value.trim();
    if (!val) return alert('Enter owner wallet address');
    setOwner(val);
    refreshAll();
  });

  $('refresh-txs').addEventListener('click', ()=>{ refreshTxs(); });

  function refreshAll(){
    fetchStatus().then(renderStatus).catch(err=>{
      $('conn-output').textContent = 'Error: '+err.message;
    });
    refreshTxs();
  }

  function refreshTxs(){
    fetchTxs().then(renderTxs).catch(err=>{
      $('tx-list').innerHTML = '<li>Error: '+err.message+'</li>';
    });
  }

  // On load, populate owner input from session or ask once via prompt for convenience.
  window.addEventListener('load', ()=>{
    const saved = getOwner();
    if (!saved) {
      try{
        const p = prompt('Enter your owner wallet address (x-owner-wallet). This is required for owner-only access.');
        if (p) setOwner(p.trim());
      }catch(e){}
    }
    $('owner-wallet-input').value = getOwner();
    refreshAll();
  });
})();
