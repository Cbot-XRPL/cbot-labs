"use strict";

/* The gate here is cosmetic — it decides what to *show*. The real gate is in
 * server.js: /api/cluster/admin returns 401/403 and no payload unless the
 * session belongs to an owner account. This file could be rewritten by anyone
 * in devtools and still learn nothing. */

const REFRESH_MS = 15000;
let timer = null;

const el = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v) => (typeof v === "number" ? v.toLocaleString() : "—");
const gib = (v) => (typeof v === "number" ? `${v.toFixed(1)} GiB` : "—");

function dur(s) {
  if (!s) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function showGate(title, msg, { signin = false } = {}) {
  el("gate").hidden = false;
  el("panel").hidden = true;
  el("gate-title").textContent = title;
  el("gate-msg").textContent = msg || "";
  el("gate-actions").hidden = !signin;
}

function tile(label, value, note, tone) {
  return `<div class="cluster-tile" data-tone="${tone || ""}">
    <span class="cluster-tile-label">${esc(label)}</span>
    <span class="cluster-tile-value">${esc(value)}</span>
    <span class="cluster-tile-note">${esc(note || "")}</span></div>`;
}

function adminNode(n) {
  if (!n.enabled) {
    return `<div class="cluster-node" data-tone=""><div class="cluster-node-head">
      <strong>${esc(n.name)}</strong><span class="pill">phase ${esc(n.phase)}</span></div>
      <div class="cluster-kv"><span>state</span><span>not provisioned</span></div>
      <div class="cluster-kv"><span>db cap</span><span>${esc(n.spec?.db_gib)} GiB</span></div></div>`;
  }
  const L = n.ledger || {};
  const db = n.db || {};
  const synced = ["full", "proposing", "validating"].includes(L.server_state);
  const tone = !n.reachable ? "bad" : synced ? "ok" : "warn";
  const errs = (n.errors || []).map((e) => `<div class="admin-err">${esc(e)}</div>`).join("");
  const api = n.api || {};
  return `<div class="cluster-node" data-tone="${tone}">
    <div class="cluster-node-head"><strong>${esc(n.name)}</strong>
      <span class="pill ${tone}">${esc(n.reachable ? (L.server_state || "up") : "unreachable")}</span></div>
    <div class="cluster-kv"><span>role / vmid</span><span>${esc(n.role)} · ${esc(n.vmid)}</span></div>
    <div class="cluster-kv"><span>address</span><span>${esc(n.address)}</span></div>
    <div class="cluster-kv"><span>validated</span><span>${num(L.validated_seq)}</span></div>
    <div class="cluster-kv"><span>window</span><span>${num(L.count)} ledgers</span></div>
    <div class="cluster-kv"><span>peers</span><span>${num(L.peers)}</span></div>
    <div class="cluster-kv"><span>db volume</span><span>${gib(db.used_gib)} / ${esc(n.spec?.db_gib)} GiB${db.pct != null ? ` (${db.pct}%)` : ""}</span></div>
    <div class="cluster-kv"><span>memory</span><span>${gib(n.mem?.used_gib)} / ${gib(n.mem?.total_gib)}</span></div>
    <div class="cluster-kv"><span>uptime</span><span>${dur(n.uptime_s)}</span></div>
    <div class="cluster-kv"><span>public api</span><span>${api.ok_count != null ? `${api.ok_count}/${api.total} · ws ${esc(api.ws_code)} · admin ${esc(api.admin_refused_code)}` : "—"}</span></div>
    ${errs}
  </div>`;
}

async function load() {
  try {
    const res = await fetch("/api/cluster/admin", { headers: { accept: "application/json" } });

    if (res.status === 401) {
      return showGate("Sign in required", "This page needs a Xaman signature from an owner account.", { signin: true });
    }
    if (res.status === 403) {
      return showGate("Not an owner account", "You are signed in, but this account is not on the owner list.");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return showGate("Ops dashboard unreachable",
        `${body.detail || res.status}. The dashboard runs inside xah-node-1 on the LAN — this server must be able to reach it.`);
    }

    const d = await res.json();
    el("gate").hidden = true;
    el("panel").hidden = false;
    el("admin-nodes").innerHTML = (d.nodes || []).map(adminNode).join("");

    // The ops dashboard deliberately never contacts the hypervisor — that is
    // its containment rule, not an omission — so there is no host.pool here.
    // Summarise what it DOES collect: aggregate database capacity across the
    // cluster, which is the number that actually decides when to act.
    const c = d.cluster || {};
    const usedPct = c.db_cap_gib ? (c.db_used_gib / c.db_cap_gib) * 100 : null;
    el("admin-host").innerHTML = [
      tile("Cluster DB used",
        usedPct != null ? `${usedPct.toFixed(1)}%` : "—",
        `${num(Math.round(c.db_used_gib || 0))} of ${num(c.db_cap_gib)} GiB capped`,
        usedPct >= 80 ? "bad" : usedPct >= 60 ? "warn" : "ok"),
      tile("Nodes", `${c.nodes_enabled ?? "—"}/${c.nodes_total ?? "—"}`, `phase ${c.phase ?? "—"}`),
      tile("Network", c.network || "—", `NetworkID ${c.network_id ?? "—"}`),
      tile("Collector", `${d.collect_ms ?? "—"} ms`, `refresh ${d.refresh_s ?? "—"}s · age ${Math.round(d.age_s ?? 0)}s`,
        (d.age_s ?? 0) > (d.refresh_s ?? 20) * 3 ? "warn" : "ok")
    ].join("");
    el("admin-stamp").textContent = `Updated ${new Date((d.generated_at || 0) * 1000).toLocaleTimeString()}`;
  } catch (error) {
    showGate("Could not load", error.message);
  }
}

async function signIn() {
  const btn = el("gate-signin");
  btn.disabled = true;
  btn.textContent = "Opening Xaman…";
  try {
    // Field names match server.js exactly: { uuid, qrPng, always } from start,
    // { resolved, signed, account, isOwner } from poll.
    const start = await fetch("/api/auth/xaman/start", { method: "POST" }).then((r) => r.json());
    if (!start.uuid) throw new Error(start.error || "could not start sign-in");
    if (start.qrPng) {
      const slot = el("gate-qr-slot");
      slot.innerHTML = "";
      const img = document.createElement("img");
      img.id = "gate-qr-img";
      img.alt = "Xaman sign-in QR code";
      img.width = 220;
      img.height = 220;
      img.src = start.qrPng;
      slot.appendChild(img);
      el("gate-qr").hidden = false;
    }
    if (start.always) el("gate-qr-link").href = start.always;

    for (let i = 0; i < 90; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(`/api/auth/xaman/poll/${start.uuid}`).then((r) => r.json());
      if (!poll.resolved) continue;
      el("gate-qr").hidden = true;
      if (!poll.signed) throw new Error("sign-in was rejected");
      // Signed but not an owner: say so here rather than letting load() show a
      // bare 403, which reads like a bug rather than a decision.
      if (!poll.isOwner) {
        return showGate("Not an owner account",
          `Signed in as ${poll.account}, but that account is not on the owner list.`);
      }
      await whoami();
      return load();
    }
    throw new Error("sign-in expired");
  } catch (error) {
    el("gate-msg").textContent = error.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in with Xaman";
  }
}

async function whoami() {
  try {
    const s = await fetch("/api/auth/session").then((r) => r.json());
    if (s.loggedIn) {
      el("admin-who").textContent = `${s.account.slice(0, 6)}…${s.account.slice(-4)}${s.isOwner ? "" : " (not owner)"}`;
      el("admin-signout").hidden = false;
    }
  } catch (_e) { /* the gate below reports the real problem */ }
}

window.addEventListener("DOMContentLoaded", () => {
  el("gate-signin").addEventListener("click", signIn);
  el("admin-signout").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  });
  whoami();
  load();
  timer = setInterval(() => { if (!el("panel").hidden) load(); }, REFRESH_MS);
});
