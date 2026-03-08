(function(){
  // Minimal owner-only client to display sanitized wallet & ecosystem metrics.
  // Expects owner-only server endpoints under /api/admin/trading/* or /api/admin/wallet/*

  const $ = id => document.getElementById(id);
  const endpoints = {
    status: '/api/admin/trading/status',
    txs: '/api/admin/trading/txs?limit=10',
    metrics: '/api/admin/trading/metrics'
  };

  async function fetchJson(url){
    try{
      const res = await fetch(url, {credentials:'same-origin'});
      if(!res.ok) throw new Error('HTTP '+res.status);
      return await res.json();
    }catch(e){
      console.warn('fetch error', url, e);
      throw e;
    }
  }

  async function refresh(){
    try{
      const status = await fetchJson(endpoints.status);
      updateStatus(status);
    }catch(e){
      markDisconnected();
    }

    try{
      const txs = await fetchJson(endpoints.txs);
      updateTxs(txs);
    }catch(e){
      // best-effort
    }

    try{
      const metrics = await fetchJson(endpoints.metrics);
      updateMetrics(metrics);
    }catch(e){
      // best-effort
    }
  }

  function updateStatus(s){
    $('address').textContent = s.address || '—';
    $('balance').textContent = s.balanceXRP ? s.balanceXRP + ' XRP' : (s.balanceDrops ? (s.balanceDrops + ' drops') : '—');
    $('lastLedger').textContent = s.lastLedger || '—';
    $('lastSync').textContent = s.lastSyncTs || new Date().toISOString();
    $('snapshotId').textContent = s.snapshotId || '—';
    $('networkLabel').textContent = s.network || 'UNKNOWN';
    setConnected(!!s.connected);
  }

  function setConnected(ok){
    const el = $('connStatus');
    el.textContent = ok ? 'connected' : 'disconnected';
    el.className = ok ? 'dot green' : 'dot red';
  }

  function markDisconnected(){
    setConnected(false);
    $('balance').textContent = '—';
  }

  function updateTxs(payload){
    const container = $('txList');
    if(!payload || !Array.isArray(payload.txs)){
      container.textContent = '(no txs)';
      return;
    }
    const ul = document.createElement('div');
    ul.style.display = 'grid';
    ul.style.gridTemplateColumns = '1fr';
    ul.style.gap = '6px';
    payload.txs.forEach(tx => {
      const d = document.createElement('div');
      d.style.border = '1px solid #222';
      d.style.padding = '8px';
      d.style.borderRadius = '6px';
      d.innerHTML = `<div><strong>${tx.direction || tx.type || 'tx'}</strong> ${tx.amount || ''}</div><div style="color:#999;font-size:0.9rem">ledger ${tx.ledger || '—'} • ${tx.memo || ''}</div>`;
      ul.appendChild(d);
    });
    container.innerHTML = '';
    container.appendChild(ul);
  }

  function updateMetrics(metrics){
    // Minimal wiring: display raw JSON placeholders for now.
    $('xahauPanel').textContent = metrics.xahau ? JSON.stringify(metrics.xahau, null, 2) : '(no xahau metrics)';
    $('flarePanel').textContent = metrics.flare ? JSON.stringify(metrics.flare, null, 2) : '(no flare metrics)';
    $('evmPanel').textContent = metrics.evm ? JSON.stringify(metrics.evm, null, 2) : '(no evm metrics)';
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    const refreshBtn = $('refreshBtn');
    const autoToggle = $('autoRefreshToggle');

    refreshBtn.addEventListener('click', ()=>{
      refreshBtn.disabled = true;
      refresh().finally(()=>refreshBtn.disabled=false);
    });

    let interval = null;
    function startAuto(){
      if(interval) clearInterval(interval);
      interval = setInterval(()=>{ refresh().catch(()=>{}); }, 10000);
    }
    function stopAuto(){ if(interval) clearInterval(interval); interval=null }

    autoToggle.addEventListener('change',(e)=>{ if(e.target.checked) startAuto(); else stopAuto(); });
    if(autoToggle.checked) startAuto();

    // initial
    refresh();
  });
})();
