'use strict';

// Read x-owner-wallet from prompt-less location: the UI should not store secrets.
// For owner-only testing, the operator can configure the browser devtools to send the header.
// This client reads a small shim value from localStorage if present for convenience in owner-only environments.

const output = document.getElementById('output');
const refreshBtn = document.getElementById('refresh');

async function fetchStatus() {
  output.textContent = 'Fetching status...';
  // Optionally send x-owner-wallet header from localStorage (owner-only convenience).
  const ownerHeader = localStorage.getItem('x-owner-wallet') || '';
  try {
    const resp = await fetch('/api/admin/trading/status', {
      method: 'GET',
      headers: ownerHeader ? { 'x-owner-wallet': ownerHeader } : {},
    });
    const json = await resp.json();
    output.textContent = JSON.stringify(json, null, 2);
  } catch (err) {
    output.textContent = 'Error fetching status: ' + String(err);
  }
}

refreshBtn.addEventListener('click', fetchStatus);

// Initial load
fetchStatus();
