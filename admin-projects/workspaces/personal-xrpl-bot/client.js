async function api(path, opts = {}) {
  const owner = document.getElementById("ownerHeader").value.trim();
  const headers = opts.headers || {};
  if (owner) {
    headers["x-owner-wallet"] = owner;
  }
  const res = await fetch(path, Object.assign({ headers }, opts));
  return res.json();
}

function showStatus(obj) {
  document.getElementById("statusPre").innerText = JSON.stringify(obj, null, 2);
}

function renderMetrics(list) {
  const el = document.getElementById("metricsList");
  if (!list || list.length === 0) {
    el.innerText = "No samples yet";
    return;
  }

  el.innerHTML = "";
  list.slice(0, 10).forEach((entry) => {
    const d = document.createElement("div");
    const ts = entry.ts || entry.at || "unknown";
    const ledgerIndex = entry?.sample?.xrpl?.ledger_index ?? entry?.sample?.ledger_index ?? "n/a";
    d.innerText = `${ts} - ledger: ${ledgerIndex}`;
    el.appendChild(d);
  });
}

function renderTrades(list) {
  const el = document.getElementById("tradesList");
  if (!list || list.length === 0) {
    el.innerText = "No trades yet";
    return;
  }

  el.innerHTML = "";
  list.slice(0, 10).forEach((trade) => {
    const d = document.createElement("div");
    const ts = trade.ts || trade.at || "unknown";
    d.innerText = `${ts} | ${trade.side} ${trade.size}@${trade.price ?? "n/a"} ${trade.note || ""}`;
    el.appendChild(d);
  });
}

function renderEcosystem(metrics, status) {
  const latest = Array.isArray(metrics) && metrics.length ? metrics[0].sample || {} : {};
  document.getElementById("xahauVal").innerText = latest?.xahau?.price_estimate
    ? `est: ${latest.xahau.price_estimate}`
    : "probe: pending";
  document.getElementById("xrplVal").innerText = status?.status?.address
    ? `account: ${status.status.address}`
    : "no-account-probe";
  document.getElementById("flareVal").innerText = latest?.flare?.price_estimate
    ? `est: ${latest.flare.price_estimate}`
    : "probe: pending";
  document.getElementById("evmVal").innerText = latest?.evm?.native_price_estimate
    ? `est: ${latest.evm.native_price_estimate}`
    : "probe: pending";
}

async function loadAll() {
  try {
    const status = await api("/api/admin/personal-bot/status");
    showStatus(status);
    const metrics = await api("/api/admin/personal-bot/metrics");
    if (metrics.ok) {
      renderMetrics(metrics.metrics);
      renderTrades(metrics.trades);
      renderEcosystem(metrics.metrics, status);
    }
  } catch (error) {
    showStatus({ error: String(error) });
  }
}

document.getElementById("statusBtn").addEventListener("click", () => loadAll());

document.getElementById("pollBtn").addEventListener("click", async () => {
  const res = await api("/api/admin/personal-bot/poll", { method: "POST" });
  if (res.ok) {
    alert("Polled - sample recorded");
    loadAll();
  } else {
    alert(`Poll failed: ${JSON.stringify(res)}`);
  }
});

document.getElementById("simulateBtn").addEventListener("click", async () => {
  const side = prompt("side (buy/sell)", "buy");
  const size = prompt("size", "1");
  const price = prompt("price", "0.01");
  if (!side || !size || !price) {
    return alert("aborted");
  }
  const res = await api("/api/admin/personal-bot/simulate-trade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ side, size, price, note: "manual simulate" })
  });
  if (res.ok) {
    alert("Simulated trade recorded");
    loadAll();
  } else {
    alert(`Simulate failed: ${JSON.stringify(res)}`);
  }
});

loadAll();
