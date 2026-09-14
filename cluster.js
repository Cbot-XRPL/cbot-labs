"use strict";

const REFRESH_MS = 20000;

function el(id) { return document.getElementById(id); }
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function num(v) { return typeof v === "number" ? v.toLocaleString() : "—"; }
function dur(s) {
  if (!s) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function tile(label, value, note, tone) {
  return `<div class="cluster-tile" data-tone="${tone || ""}">
    <span class="cluster-tile-label">${esc(label)}</span>
    <span class="cluster-tile-value">${esc(value)}</span>
    <span class="cluster-tile-note">${esc(note || "")}</span>
  </div>`;
}

function nodeCard(n) {
  if (!n.reachable) {
    return `<div class="cluster-node" data-tone="bad">
      <div class="cluster-node-head"><strong>${esc(n.label)}</strong><span class="pill bad">unreachable</span></div>
      <div class="cluster-kv"><span>status</span><span>${esc(n.error || "no answer")}</span></div>
    </div>`;
  }
  // Mirrors nodeKeepingUp() on the server: a backfilling node dips to
  // tracking/syncing for seconds at a time and that is not a fault. Ledger age
  // is what says whether it is keeping pace.
  const current = n.ledgerAgeS != null && n.ledgerAgeS <= 20;
  const synced = ["full", "proposing", "validating"].includes(n.serverState)
    ? (n.ledgerAgeS == null || n.ledgerAgeS <= 60)
    : (["tracking", "syncing"].includes(n.serverState) && current);
  const range = n.low ? `${num(n.low)}–${num(n.high)}` : (n.completeLedgers || "—");
  return `<div class="cluster-node" data-tone="${synced ? "ok" : "warn"}">
    <div class="cluster-node-head"><strong>${esc(n.label)}</strong>
      <span class="pill ${synced ? "ok" : "warn"}">${esc(n.serverState || "?")}</span></div>
    <div class="cluster-kv"><span>validated ledger</span><span>${num(n.validatedSeq)}</span></div>
    <div class="cluster-kv"><span>ledger age</span><span>${n.ledgerAgeS ?? "—"}s</span></div>
    <div class="cluster-kv"><span>history window</span><span>${num(n.count)} ledgers</span></div>
    <div class="cluster-kv"><span>range</span><span>${esc(range)}</span></div>
    <div class="cluster-kv"><span>peers</span><span>${num(n.peers)}</span></div>
    <div class="cluster-kv"><span>uptime</span><span>${dur(n.uptimeS)}</span></div>
    <div class="cluster-kv"><span>build</span><span>${esc(n.build || "—")}</span></div>
  </div>`;
}

function snippets(rpc, ws) {
  el("ep-rpc").textContent = rpc;
  el("ep-ws").textContent = ws;
  el("snippet-curl").textContent =
`curl ${rpc} \\
  -H 'content-type: application/json' \\
  -d '{"method":"server_info","params":[{}]}'`;
  el("snippet-account").textContent =
`curl ${rpc} \\
  -H 'content-type: application/json' \\
  -d '{"method":"account_info","params":[{
        "account":"rExampleAccountAddressHere",
        "ledger_index":"validated"}]}'`;
  el("snippet-ws").textContent =
`import { Client } from 'xahau'

const client = new Client('${ws}')
await client.connect()

console.log(await client.request({ command: 'server_info' }))

// live ledger stream
await client.request({ command: 'subscribe', streams: ['ledger'] })
client.on('ledgerClosed', l => console.log(l.ledger_index, l.txn_count))`;
}

async function refresh() {
  try {
    const res = await fetch("/api/cluster", { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();

    const tone = d.health === "ok" ? "ok" : d.health === "degraded" ? "warn" : "bad";
    el("cluster-badges").innerHTML =
      `<span class="pill ${tone}">${esc(d.health)}</span>` +
      `<span class="pill">${esc(d.network)}</span>` +
      `<span class="pill">NetworkID ${esc(d.networkId)}</span>`;

    el("cluster-tiles").innerHTML = [
      tile("Nodes online", `${d.nodesUp}/${d.nodesTotal}`, "clustered", tone),
      tile("Validated ledger", num(d.validatedSeq), "latest"),
      tile("History window", num(d.historyLedgers), "ledgers available"),
      tile("Peers", num(d.peers), "network connections")
    ].join("");

    el("cluster-nodes").innerHTML = (d.nodes || []).map(nodeCard).join("");
    snippets(d.endpoints.rpc, d.endpoints.ws);
    el("cluster-stamp").textContent =
      (d.stale ? "Showing last known state — " : "") +
      `Updated ${new Date(d.ts).toLocaleTimeString()} · refreshes every ${REFRESH_MS / 1000}s`;
  } catch (error) {
    el("cluster-stamp").textContent = `Status unavailable (${error.message}). The API itself may still be fine — try the curl example.`;
  }
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".copy-btn");
  if (!btn) return;
  const text = el(btn.dataset.copy)?.textContent || "";
  navigator.clipboard?.writeText(text).then(() => {
    const old = btn.textContent;
    btn.textContent = "copied";
    setTimeout(() => { btn.textContent = old; }, 1200);
  });
});

window.addEventListener("DOMContentLoaded", () => {
  snippets("https://cluster.cbotlabs.xyz", "wss://ws-cluster.cbotlabs.xyz");
  refresh();
  setInterval(refresh, REFRESH_MS);
});
