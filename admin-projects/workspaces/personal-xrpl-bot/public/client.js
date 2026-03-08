(function () {
  const base = "";
  const ownerInput = document.getElementById("ownerWallet");
  const btnStatus = document.getElementById("btnStatus");
  const btnPoll = document.getElementById("btnPoll");
  const btnSimTrade = document.getElementById("btnSimTrade");
  const statusPre = document.getElementById("status");
  const metricsDiv = document.getElementById("metrics");
  const tradesDiv = document.getElementById("trades");

  function ownerHeader() {
    const val = ownerInput.value.trim();
    return val ? { "x-owner-wallet": val } : {};
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) {
      el.innerText = value;
    }
  }

  async function refreshStatus() {
    statusPre.textContent = "loading...";
    try {
      const res = await fetch(base + "/api/admin/personal-bot/status", { headers: ownerHeader() });
      const j = await res.json();
      statusPre.textContent = JSON.stringify(j, null, 2);
    } catch (e) {
      statusPre.textContent = `error: ${e.message}`;
    }
  }

  async function refreshMetrics() {
    metricsDiv.textContent = "loading...";
    tradesDiv.textContent = "loading...";
    try {
      const res = await fetch(base + "/api/admin/personal-bot/metrics", { headers: ownerHeader() });
      const j = await res.json();
      if (!j.ok) {
        metricsDiv.textContent = `error: ${JSON.stringify(j)}`;
        tradesDiv.textContent = "";
        return;
      }

      const metrics = j.metrics || [];
      const trades = j.trades || [];
      metricsDiv.innerHTML = metrics.slice(0, 10).map((it) => `<div><strong>${it.ts}</strong><pre>${JSON.stringify(it.sample, null, 2)}</pre></div>`).join("") || "(no metrics)";
      tradesDiv.innerHTML = trades.slice(0, 20).map((trade) => `<div><strong>${trade.ts}</strong><div>${trade.side} ${trade.size} ${trade.token}</div></div>`).join("") || "(no trades)";

      const latest = metrics[0]?.sample || {};
      setText("xahauVal", latest?.xahau?.price_estimate ? `est: ${latest.xahau.price_estimate}` : "probe: pending");
      setText("xrplVal", latest?.xrpl?.address ? `account: ${latest.xrpl.address}` : "no-account-probe");
      setText("flareVal", latest?.flare?.price_estimate ? `est: ${latest.flare.price_estimate}` : "probe: pending");
      setText("evmVal", latest?.evm?.native_price_estimate ? `est: ${latest.evm.native_price_estimate}` : "probe: pending");
    } catch (e) {
      metricsDiv.textContent = `error: ${e.message}`;
      tradesDiv.textContent = "";
    }
  }

  btnStatus.addEventListener("click", async () => {
    await refreshStatus();
    await refreshMetrics();
  });

  btnPoll.addEventListener("click", async () => {
    try {
      btnPoll.disabled = true;
      const res = await fetch(base + "/api/admin/personal-bot/poll", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, ownerHeader())
      });
      const j = await res.json();
      if (j.ok) {
        await refreshMetrics();
      } else {
        alert(`poll error: ${JSON.stringify(j)}`);
      }
    } catch (e) {
      alert(`error: ${e.message}`);
    } finally {
      btnPoll.disabled = false;
    }
  });

  btnSimTrade.addEventListener("click", async () => {
    try {
      const payload = { side: "buy", token: "XAHAU", size: 1 };
      const res = await fetch(base + "/api/admin/personal-bot/simulate-trade", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, ownerHeader()),
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (j.ok) {
        await refreshMetrics();
      } else {
        alert(`simulate error: ${JSON.stringify(j)}`);
      }
    } catch (e) {
      alert(`error: ${e.message}`);
    }
  });

  refreshMetrics();
})();
