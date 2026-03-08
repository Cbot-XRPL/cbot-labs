async function api(path, opts = {}){
  const owner = document.getElementById('ownerHeader').value.trim();
  const headers = opts.headers || {};
  if (owner) headers['x-owner-wallet'] = owner;
  const res = await fetch(path, Object.assign({ headers }, opts));
  return res.json();
}

function showStatus(obj){
  document.getElementById('statusPre').innerText = JSON.stringify(obj, null, 2);
}

function renderMetrics(list){
  const el = document.getElementById('metricsList');
  if (!list || list.length===0){ el.innerText = 'No samples yet'; return }
  el.innerHTML = '';
  list.slice(0,10).forEach(s =>{
    const d = document.createElement('div');
    d.innerText = `${s.at} — ledger: ${s.sample.ledger_index || 'n/a'}`;
    el.appendChild(d);
  });
}

function renderTrades(list){
  const el = document.getElementById('tradesList');
  if (!list || list.length===0){ el.innerText = 'No trades yet'; return }
  el.innerHTML = '';
  list.slice(0,10).forEach(t =>{
    const d = document.createElement('div');
    d.innerText = `${t.at} | ${t.side} ${t.size}@${t.price} ${t.note||''}`;
    el.appendChild(d);
  });
}

async function loadAll(){
  try{
    const s = await api('/api/admin/personal-bot/status');
    showStatus(s);
    const m = await api('/api/admin/personal-bot/metrics');
    if (m.ok){ renderMetrics(m.metrics); renderTrades(m.trades); }
    // Ecosystem token placeholders — real probes can be wired in later
    document.getElementById('xahauVal').innerText = 'probe: pending';
    document.getElementById('xrplVal').innerText = s.status && s.status.account ? 'account: present' : 'no-account-probe';
    document.getElementById('flareVal').innerText = 'probe: pending';
    document.getElementById('evmVal').innerText = 'probe: pending';
  }catch(e){ showStatus({error:String(e)}) }
}

document.getElementById('statusBtn').addEventListener('click', ()=>loadAll());

document.getElementById('pollBtn').addEventListener('click', async ()=>{
  const res = await api('/api/admin/personal-bot/poll', { method: 'POST' });
  if (res.ok){ alert('Polled — sample recorded'); loadAll(); } else alert('Poll failed: '+JSON.stringify(res));
});

document.getElementById('simulateBtn').addEventListener('click', async ()=>{
  const side = prompt('side (buy/sell)', 'buy');
  const size = prompt('size', '1');
  const price = prompt('price', '0.01');
  if (!side || !size || !price) return alert('aborted');
  const res = await api('/api/admin/personal-bot/simulate-trade', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ side, size, price, note: 'manual simulate' }) });
  if (res.ok){ alert('Simulated trade recorded'); loadAll(); } else alert('Simulate failed: '+JSON.stringify(res));
});

// Initial load
loadAll();
