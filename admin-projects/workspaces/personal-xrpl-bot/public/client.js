(function(){
  const base = '';
  const ownerInput = document.getElementById('ownerWallet');
  const btnStatus = document.getElementById('btnStatus');
  const btnPoll = document.getElementById('btnPoll');
  const btnSimTrade = document.getElementById('btnSimTrade');
  const statusPre = document.getElementById('status');
  const metricsDiv = document.getElementById('metrics');
  const tradesDiv = document.getElementById('trades');

  function ownerHeader() {
    const val = ownerInput.value.trim();
    return val ? { 'x-owner-wallet': val } : {};
  }

  async function refreshStatus(){
    statusPre.textContent = 'loading...';
    try{
      const res = await fetch(base + '/api/admin/personal-bot/status', { headers: ownerHeader() });
      const j = await res.json();
      statusPre.textContent = JSON.stringify(j, null, 2);
    }catch(e){ statusPre.textContent = 'error: '+e.message }
  }

  async function refreshMetrics(){
    metricsDiv.textContent = 'loading...';
    try{
      const res = await fetch(base + '/api/admin/personal-bot/metrics', { headers: ownerHeader() });
      const j = await res.json();
      if(!j.ok){ metricsDiv.textContent = 'error: '+JSON.stringify(j); return }
      const m = j.metrics || [];
      const t = j.trades || [];
      metricsDiv.innerHTML = m.slice(0,10).map(it=>`<div><strong>${it.ts}</strong><pre>${JSON.stringify(it.sample,null,2)}</pre></div>`).join('') || '(no metrics)';
      tradesDiv.innerHTML = t.slice(0,20).map(tr=>`<div><strong>${tr.ts}</strong><div>${tr.side} ${tr.size} ${tr.token}</div></div>`).join('') || '(no trades)';
    }catch(e){ metricsDiv.textContent = 'error: '+e.message }
  }

  btnStatus.addEventListener('click', async ()=>{ await refreshStatus(); await refreshMetrics(); });
  btnPoll.addEventListener('click', async ()=>{
    try{
      btnPoll.disabled = true;
      const res = await fetch(base + '/api/admin/personal-bot/poll', { method: 'POST', headers: Object.assign({'Content-Type':'application/json'}, ownerHeader()) });
      const j = await res.json();
      if(j.ok){ await refreshMetrics(); }
      else alert('poll error: '+JSON.stringify(j));
    }catch(e){ alert('error: '+e.message) }finally{ btnPoll.disabled = false }
  });

  btnSimTrade.addEventListener('click', async ()=>{
    try{
      const payload = { side: 'buy', token: 'XAHAU', size: 1 };
      const res = await fetch(base + '/api/admin/personal-bot/simulate-trade', { method: 'POST', headers: Object.assign({'Content-Type':'application/json'}, ownerHeader()), body: JSON.stringify(payload) });
      const j = await res.json();
      if(j.ok){ await refreshMetrics(); }
      else alert('simulate error: '+JSON.stringify(j));
    }catch(e){ alert('error: '+e.message) }
  });

  // initial load
  refreshMetrics();
})();
