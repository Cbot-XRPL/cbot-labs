// Simple client for the XRPL trading bot dashboard.
// Calls owner-only endpoint /api/admin/trading/status

async function fetchStatus() {
  try {
    const res = await fetch('/api/admin/trading/status', { credentials: 'same-origin' });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error('Server error: ' + res.status + ' ' + txt);
    }
    return await res.json();
  } catch (err) {
    throw err;
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

async function refresh() {
  setText('notice', 'Refreshing...');
  try {
    const data = await fetchStatus();
    setText('addr', data.address || 'Not configured');
    setText('online', data.online ? 'Yes' : 'No');
    setText('balance', (data.balance && data.balance.xrp) ? data.balance.xrp : '—');
    setText('notice', 'Updated at ' + new Date().toLocaleString());
  } catch (err) {
    setText('notice', 'Error: ' + (err && err.message ? err.message : err));
    setText('addr', '—');
    setText('online', 'No');
    setText('balance', '—');
  }
}

document.getElementById('refresh').addEventListener('click', () => {
  refresh();
});

// Auto-refresh on load
window.addEventListener('load', () => {
  refresh();
});
