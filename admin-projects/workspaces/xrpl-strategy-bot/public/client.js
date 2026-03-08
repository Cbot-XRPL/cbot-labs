(function(){
  const ownerInput = document.getElementById('owner');
  const statusEl = document.getElementById('status');
  const metricsEl = document.getElementById('metrics');
  const tradesEl = document.getElementById('trades');
  const triggerBtn = document.getElementById('trigger');

  function hdrs() {
    return { 'x-owner-wallet': ownerInput.value.trim() };
  }

  async function fetchStatus() {
    try {
      const r = await fetch('/api/admin/strategies/status', { headers: hdrs() });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      renderStatus(j.status);
    } catch (err) {
      statusEl.textContent = 'Error: ' + err.message;
    }
  }

  function renderStatus(s) {
    statusEl.innerHTML = '';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(s, null, 2);
    statusEl.appendChild(pre);
  }

  async function fetchMetrics() {
    try {
      const r = await fetch('/api/admin/strategies/metrics', { headers: hdrs() });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      metricsEl.innerHTML = '<pre>' + JSON.stringify(j.metrics, null, 2) + '</pre>';
    } catch (err) {
      metricsEl.textContent = 'Error: ' + err.message;
    }
  }

  async function fetchTrades() {
    try {
      const r = await fetch('/api/admin/strategies/trades', { headers: hdrs() });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      tradesEl.innerHTML = '<pre>' + JSON.stringify(j.trades.slice(-50).reverse(), null, 2) + '</pre>';
    } catch (err) {
      tradesEl.textContent = 'Error: ' + err.message;
    }
  }

  triggerBtn.addEventListener('click', async () => {
    try {
      triggerBtn.disabled = true;
      triggerBtn.textContent = 'Running...';
      const r = await fetch('/api/admin/strategies/trigger', { method: 'POST', headers: hdrs() });
      const j = await r.json();
      alert('Trigger result: ' + JSON.stringify(j.result || j, null, 2));
      await refreshAll();
    } catch (err) {
      alert('Trigger error: ' + err.message);
    } finally {
      triggerBtn.disabled = false;
      triggerBtn.textContent = 'Run One Tick';
    }
  });

  async function refreshAll() {
    await fetchStatus();
    await fetchMetrics();
    await fetchTrades();
  }

  // polling the dashboard
  setInterval(refreshAll, 5000);
  refreshAll();
})();
