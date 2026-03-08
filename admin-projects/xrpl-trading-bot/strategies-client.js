(function(){
  const listEl = document.getElementById('list');
  const reloadBtn = document.getElementById('reload');
  const startBtn = document.getElementById('startSim');
  const stopBtn = document.getElementById('stopSim');
  let strategies = [];
  let simTimer = null;
  let simT = 0;

  async function loadStrategies(){
    try{
      const res = await fetch('./strategies.json');
      strategies = await res.json();
      renderList();
    } catch(e){
      listEl.innerHTML = '<p class="meta">Failed to load strategies.json: '+(e.message||e)+' </p>'
    }
  }

  function renderList(){
    listEl.innerHTML = '';
    strategies.forEach((s, idx)=>{
      const el = document.createElement('div');
      el.className = 'strategy';
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:18px;color:#fff">${escapeHtml(s.title)}</div>
            <div class="meta">${escapeHtml(s.summary)}</div>
          </div>
          <div style="text-align:right">
            <div class="signal" id="sig-${idx}">${s.defaultSignal||'—'}</div>
            <div class="meta">Last simulated: <span id="time-${idx}">—</span></div>
          </div>
        </div>
        <hr style="border-color:#151515;margin:8px 0">
        <div><strong>Trigger:</strong> <span class="trigger">${escapeHtml(s.trigger)}</span></div>
        <div><strong>Action:</strong> ${escapeHtml(s.action)}</div>
        <div><strong>Sizing:</strong> ${escapeHtml(s.sizing)}</div>
        <div><strong>Prereqs:</strong> <span class="prereqs">${escapeHtml(s.prereqs)}</span></div>
        <div style="margin-top:8px;color:#9aa">Notes: ${escapeHtml(s.notes)}</div>
      `;
      listEl.appendChild(el);
    });
  }

  function escapeHtml(str){
    if(!str) return '';
    return String(str).replace(/[&<>\"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c] });
  }

  // Simple RSI-like oscillator generator (no external data) to demo signals
  function rsiMock(t, period=14){
    // produce value 10..90 using multiple sines for variability
    const v = 50 + 40*Math.sin(t*0.12) + 12*Math.sin(t*0.03 + 1.1) + 6*Math.sin(t*0.007 + 0.4);
    return Math.max(1, Math.min(99, Math.round(v)));
  }

  function stepSim(){
    simT += 1;
    strategies.forEach((s, idx)=>{
      // Evaluate simple triggers based on declared trigger type
      const kind = (s.eval||'rsi').toLowerCase();
      let sig = 'HOLD';
      if(kind === 'rsi'){
        const r = rsiMock(simT, s.rsiPeriod||14);
        if(r >= (s.rsiHigh||70)) sig = 'SELL';
        else if(r <= (s.rsiLow||30)) sig = 'BUY';
        else sig = 'HOLD';
        const el = document.getElementById('sig-'+idx);
        const timeEl = document.getElementById('time-'+idx);
        if(el) el.textContent = sig + ' (RSI:'+r+')';
        if(timeEl) timeEl.textContent = new Date().toLocaleTimeString();
      } else if(kind === 'whale-flow'){
        // rare spike trigger
        const spike = Math.random() < 0.025;
        sig = spike ? 'WATCH / ALERT' : 'HOLD';
        const el = document.getElementById('sig-'+idx);
        const timeEl = document.getElementById('time-'+idx);
        if(el) el.textContent = sig;
        if(timeEl) timeEl.textContent = new Date().toLocaleTimeString();
      } else if(kind === 'arbitrage'){
        // random small odds of opportunity
        const opp = Math.random() < 0.08;
        sig = opp ? 'OPPORTUNITY' : 'HOLD';
        const el = document.getElementById('sig-'+idx);
        const timeEl = document.getElementById('time-'+idx);
        if(el) el.textContent = sig;
        if(timeEl) timeEl.textContent = new Date().toLocaleTimeString();
      } else {
        // default
        const el = document.getElementById('sig-'+idx);
        if(el) el.textContent = s.defaultSignal || '—';
      }
    });
  }

  reloadBtn.addEventListener('click', ()=> loadStrategies());
  startBtn.addEventListener('click', ()=>{
    if(simTimer) return;
    simTimer = setInterval(stepSim, 1200);
  });
  stopBtn.addEventListener('click', ()=>{
    if(simTimer) clearInterval(simTimer);
    simTimer = null;
  });

  // initial load
  loadStrategies();
})();
