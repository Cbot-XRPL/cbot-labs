let currentAppData = null;
let authPollTimer = null;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }

  return data;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });

  const text = await response.text();

  if (!response.ok) {
    let errorMessage = `Request failed: ${response.status}`;

    try {
      const data = JSON.parse(text);
      errorMessage = data?.error || errorMessage;
    } catch {
      errorMessage = text || errorMessage;
    }

    throw new Error(errorMessage);
  }

  return text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function setHref(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.href = value;
  }
}

function showElement(id, visible) {
  const element = document.getElementById(id);
  if (element) {
    element.classList.toggle("hidden", !visible);
  }
}

function normalizeContactHref(label, value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "#";
  }

  if (/^https?:\/\//i.test(raw) || raw.startsWith("mailto:")) {
    return raw;
  }

  if (label === "Email" || raw.includes("@") && !raw.startsWith("@")) {
    return `mailto:${raw}`;
  }

  if (label === "Twitter") {
    const handle = raw.replace(/^@/, "");
    return `https://twitter.com/${handle}`;
  }

  return raw;
}

function renderLinks(links) {
  const container = document.getElementById("links-list");
  if (!container) {
    return;
  }

  container.innerHTML = (links || []).map((link) => {
    const displayValue = String(link.href || "").replace(/^mailto:/, "");
    const href = normalizeContactHref(link.label, link.href);
    return `
      <a class="footer-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">
        <span class="footer-link-label">${escapeHtml(link.label)}</span>
        <span class="footer-link-value">${escapeHtml(displayValue)}</span>
      </a>
    `;
  }).join("");
}

function renderApp(appData, statusData) {
  currentAppData = appData;

  setText("brand-name", appData.brand.name);
  setText("brand-tagline", appData.brand.tagline);
  setText("brand-summary", appData.brand.summary);

  setText("status-pill", `${appData.validator.network} · ${statusData.ok ? "Online" : "Offline"}`);
  setText("validator-status", appData.validator.status === "active" ? "Online" : appData.validator.status);
  setText("validator-network", `${appData.validator.network} (${appData.validator.networkId})`);
  setText("validator-account", appData.validator.account);
  setText("validator-location", appData.validator.location);
  setText("validator-key", appData.validator.publicKey);
  setText("api-status", statusData.ok ? "Online" : "Offline");
  setText("api-updated", `Updated ${new Date(statusData.timestamp).toLocaleString()}`);
  setHref("unl-link", appData.validator.unlUrl);
  setHref("toml-source-link", appData.validator.tomlUrl);

  const navLogo = document.getElementById("nav-logo");
  if (navLogo) {
    navLogo.src = appData.brand.logo;
  }

  renderLinks(appData.links);
}

function renderError(error) {
  setText("brand-name", "Site unavailable");
  setText("brand-summary", error.message);
  setText("status-pill", "Offline");
  setText("api-status", "Offline");
}

/* ---------- Xaman auth ---------- */

function openLoginDialog() {
  const dialog = document.getElementById("login-dialog");
  if (dialog && typeof dialog.showModal === "function") {
    dialog.showModal();
  }
}

function closeLoginDialog() {
  const dialog = document.getElementById("login-dialog");
  if (dialog) {
    dialog.close();
  }

  if (authPollTimer) {
    window.clearInterval(authPollTimer);
    authPollTimer = null;
  }
}

async function refreshAuthState() {
  const auth = await fetchJson("/api/auth/session");
  const authChipText = auth.loggedIn
    ? auth.isOwner
      ? `Owner · ${auth.account}`
      : `Signed in · ${auth.account}`
    : auth.configured
      ? "Signed out"
      : "Xaman keys missing";

  setText("auth-chip", authChipText);
  showElement("auth-chip", auth.loggedIn);
  showElement("logout-button", auth.loggedIn);

  const loginButton = document.getElementById("login-button");
  if (loginButton) {
    loginButton.disabled = !auth.configured || auth.loggedIn;
    loginButton.textContent = auth.configured ? "Owner sign-in" : "Xaman not configured";
  }
}

async function startLogin() {
  const qr = document.getElementById("login-qr");
  const openLink = document.getElementById("login-open-link");

  openLoginDialog();
  setText("login-message", "Creating Xaman sign-in request…");
  showElement("login-qr", false);
  showElement("login-open-link", false);

  try {
    const login = await fetchJson("/api/auth/xaman/start", {
      method: "POST"
    });

    if (qr && login.qrPng) {
      qr.src = login.qrPng;
      showElement("login-qr", true);
    }

    if (openLink && login.always) {
      openLink.href = login.always;
      showElement("login-open-link", true);
    }

    const ownerAccount = currentAppData?.auth?.ownerAccount;
    setText("login-message", ownerAccount ? `Sign with Xaman. Owner access unlocks for ${ownerAccount}.` : "Sign in with Xaman.");

    authPollTimer = window.setInterval(async () => {
      try {
        const result = await fetchJson(`/api/auth/xaman/poll/${login.uuid}`);
        if (!result.resolved) {
          return;
        }

        closeLoginDialog();
        await refreshAuthState();
      } catch (error) {
        setText("login-message", error.message);
      }
    }, 2000);
  } catch (error) {
    setText("login-message", error.message);
  }
}

async function logout() {
  await fetchJson("/api/auth/logout", {
    method: "POST"
  });

  await refreshAuthState();
}

/* ---------- Validator TOML viewer ---------- */

function openTomlDialog() {
  const dialog = document.getElementById("toml-dialog");
  if (dialog && typeof dialog.showModal === "function") {
    dialog.showModal();
  }
}

function closeTomlDialog() {
  const dialog = document.getElementById("toml-dialog");
  if (dialog) {
    dialog.close();
  }
}

async function showToml() {
  const content = document.getElementById("toml-content");

  openTomlDialog();
  setText("toml-message", "Loading TOML…");
  showElement("toml-content", false);

  if (currentAppData?.validator?.tomlUrl) {
    setHref("toml-source-link", currentAppData.validator.tomlUrl);
  }

  try {
    const toml = await fetchText("/api/toml/xahau");
    if (content) {
      content.textContent = toml;
      showElement("toml-content", true);
    }
    setText("toml-message", "Live viewer for the validator domain TOML.");
  } catch (error) {
    setText("toml-message", error.message);
  }
}

/* ---------- oneXah live protocol metrics ---------- */

const ONEXAH_API = "https://onexah.io/api/public/v1";
const ONEXAH_REFRESH_MS = 45000;
let onexahTimer = null;

async function oxGet(path) {
  const response = await fetch(`${ONEXAH_API}${path}`, {
    headers: { Accept: "application/json" }
  });
  const json = await response.json().catch(() => null);
  if (!json?.ok) {
    throw new Error(json?.error || `oneXah ${path} returned ${response.status}`);
  }
  return json.data;
}

function fmtUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "—";
  }
  if (n > 0 && n < 1) {
    return `$${n.toPrecision(4)}`;
  }
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : 2 })}`;
}

function fmtNum(value, { compact = false, dp = 2 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "—";
  }
  if (compact && Math.abs(n) >= 1000) {
    return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

function fmtPct(fraction, dp = 2) {
  const n = Number(fraction);
  if (!Number.isFinite(n)) {
    return "—";
  }
  return `${(n * 100).toFixed(dp)}%`;
}

function rowsHtml(rows) {
  return rows.map(([label, value]) => `
    <div class="proto-row">
      <span class="k">${escapeHtml(label)}</span>
      <span class="v">${escapeHtml(value)}</span>
    </div>
  `).join("");
}

function protoCardHtml(title, tag, rows) {
  return `
    <article class="proto-card">
      <header class="proto-head">
        <h3>${escapeHtml(title)}</h3>
        <span class="proto-tag">${escapeHtml(tag)}</span>
      </header>
      <div class="proto-rows">${rowsHtml(rows)}</div>
    </article>
  `;
}

function setOnexahLive(state) {
  const pill = document.getElementById("ox-live-pill");
  const text = document.getElementById("ox-live-text");
  if (!pill || !text) {
    return;
  }

  pill.classList.remove("pill-live", "pill-warn", "pill-neutral");
  if (state === "ok") {
    pill.classList.add("pill-live");
    text.textContent = `Live · ${new Date().toLocaleTimeString()}`;
  } else if (state === "stale") {
    pill.classList.add("pill-warn");
    text.textContent = "Partial data · retrying";
  } else {
    pill.classList.add("pill-warn");
    text.textContent = "Offline · retrying";
  }
}

function renderOnexahSummary(summary, dao, lending, perps) {
  const tvlUsd = fmtUsd(summary?.tvl?.totalUsd);
  const xahUsd = fmtUsd(summary?.xahUsd);

  // Card: total XAH + EVR locked across all protocols, and DAO treasury (XAH/EVR).
  const breakdown = summary?.tvl?.breakdown || {};
  const rate = Number(summary?.rates?.xahPerEvr);
  const xahLocked = (breakdown.ammXah || 0) + (breakdown.lendingXah || 0)
    + (breakdown.perpsMargin || 0) + (breakdown.perpsLpPool || 0);
  const evrInXah = (breakdown.ammEvrInXah || 0) + (breakdown.lendingEvrInXah || 0);
  const evrLocked = Number.isFinite(rate) && rate > 0 ? evrInXah / rate : null;
  const treasuryXah = dao?.treasuryXah ?? summary?.dao?.treasuryXah;
  const treasuryEvr = dao?.treasuryEvr ?? summary?.dao?.treasuryEvr;

  setText("ox-card-xah", xahLocked > 0 ? `${fmtNum(xahLocked, { compact: true })} XAH` : "—");
  setText("ox-card-evr", evrLocked != null ? `${fmtNum(evrLocked, { compact: true })} EVR` : "—");
  setText("ox-card-dao-xah", treasuryXah != null ? `${fmtNum(treasuryXah, { dp: 0 })} XAH` : "—");
  setText("ox-card-dao-evr", treasuryEvr != null ? `${fmtNum(treasuryEvr, { dp: 0 })} EVR` : "n/a");
  setText("ox-card-lend-util", lending?.xah?.utilization != null ? fmtPct(lending.xah.utilization) : "—");
  setText("ox-card-oi", perps?.openInterest?.total != null ? `${fmtNum(perps.openInterest.total, { compact: true })} EVR` : "—");

  // Stat strip (unchanged headline numbers).
  setText("ox-tvl-usd", tvlUsd);
  setText("ox-tvl-xah", `${fmtNum(summary?.tvl?.totalXah, { compact: true })} XAH`);
  setText("ox-xahusd", xahUsd);
  setText("ox-xahevr", fmtNum(summary?.rates?.xahPerEvr, { dp: 3 }));
  setText("ox-ammfee", summary?.rates?.ammFeeBps != null ? `${(summary.rates.ammFeeBps / 100).toFixed(2)}% AMM fee` : "");
  setText("ox-dao-treasury", fmtNum(treasuryXah, { dp: 0 }));
}

function renderOnexahProtocols({ amm, lending, perps, dao, summary }) {
  const grid = document.getElementById("ox-proto-grid");
  if (!grid) {
    return;
  }

  const cards = [];

  if (amm) {
    cards.push(protoCardHtml("AMM", "XAH ⇄ EVR", [
      ["XAH reserve", `${fmtNum(amm.reserves?.xah, { compact: true })} XAH`],
      ["EVR reserve", `${fmtNum(amm.reserves?.evr, { compact: true })} EVR`],
      ["Mid rate", `${fmtNum(amm.reserves?.xahPerEvr, { dp: 3 })} XAH/EVR`],
      ["Swap fee", `${(Number(amm.feeBps) / 100).toFixed(2)}%`],
      ["TVL", fmtUsd(amm.tvl?.usd)]
    ]));
  }

  if (lending) {
    cards.push(protoCardHtml("Lending", "Supply & borrow", [
      ["XAH supplied", `${fmtNum(lending.xah?.supplied, { compact: true })} XAH`],
      ["XAH utilization", fmtPct(lending.xah?.utilization)],
      ["EVR supplied", `${fmtNum(lending.evr?.supplied, { compact: true })} EVR`],
      ["EVR utilization", fmtPct(lending.evr?.utilization)]
    ]));
  }

  if (perps) {
    cards.push(protoCardHtml("Perps", "EVR / XAH", [
      ["Open interest", `${fmtNum(perps.openInterest?.total, { compact: true })} EVR`],
      ["Long", `${fmtNum(perps.openInterest?.long, { compact: true })} EVR`],
      ["Short", `${fmtNum(perps.openInterest?.short, { compact: true })} EVR`],
      ["Long skew", fmtPct(perps.openInterest?.skew, 1)],
      ["LP pool", `${fmtNum(perps.lpPool?.reserveXah, { compact: true })} XAH`]
    ]));
  }

  const daoData = dao || (summary?.dao ? {
    treasuryXah: summary.dao.treasuryXah,
    totalStakedXxx: summary.dao.totalStakedXxx,
    emission: { currentEpoch: summary.dao.currentEpoch, ratePerEpochXxx: summary.dao.ratePerEpochXxx }
  } : null);

  if (daoData) {
    cards.push(protoCardHtml("DAO · Protocol X", "XXX", [
      ["Treasury", `${fmtNum(daoData.treasuryXah, { dp: 0 })} XAH`],
      ["Total staked", `${fmtNum(daoData.totalStakedXxx, { compact: true })} XXX`],
      ["Current epoch", `#${fmtNum(daoData.emission?.currentEpoch, { dp: 0 })}`],
      ["Rate / epoch", `${fmtNum(daoData.emission?.ratePerEpochXxx, { compact: true })} XXX`],
      ["Annual emission", daoData.emission?.annualEmissionXxx != null ? `${fmtNum(daoData.emission.annualEmissionXxx, { compact: true })} XXX` : "—"]
    ]));
  }

  grid.innerHTML = cards.join("") || `<p class="onexah-empty">Protocol data is warming up — retrying…</p>`;
}

function renderOnexahBearer(bearer) {
  const container = document.getElementById("ox-bearer");
  if (!container) {
    return;
  }

  const tokens = bearer?.bearer || {};
  const entries = Object.entries(tokens);
  if (!entries.length) {
    container.innerHTML = `<p class="onexah-empty">No bearer tokens reported.</p>`;
    return;
  }

  container.innerHTML = entries.map(([symbol, token]) => {
    const per1 = Object.values(token.redemption || {}).find((value) => value && typeof value === "object") || {};
    const formula = Object.entries(per1)
      .map(([asset, amount]) => `${fmtNum(amount, { dp: 4 })} ${asset.toUpperCase()}`)
      .join(" + ") || "—";
    const kind = String(token.kind || "").replace(/-/g, " ");
    return `
      <div class="bearer-item">
        <div class="bearer-item-head">
          <strong>${escapeHtml(symbol)}</strong>
          <span class="bearer-kind">${escapeHtml(kind)}</span>
        </div>
        <span class="bearer-formula">1 ${escapeHtml(symbol)} = ${escapeHtml(formula)}</span>
      </div>
    `;
  }).join("");
}

async function refreshOnexah() {
  const results = await Promise.allSettled([
    oxGet("/summary"),
    oxGet("/amm"),
    oxGet("/lending"),
    oxGet("/perps"),
    oxGet("/dao"),
    oxGet("/bearer-tokens")
  ]);

  const [summary, amm, lending, perps, dao, bearer] = results.map((result) =>
    result.status === "fulfilled" ? result.value : null
  );

  if (summary) {
    renderOnexahSummary(summary, dao, lending, perps);
  }
  renderOnexahProtocols({ amm, lending, perps, dao, summary });
  if (bearer) {
    renderOnexahBearer(bearer);
  }

  const okCount = results.filter((result) => result.status === "fulfilled").length;
  setOnexahLive(okCount === results.length ? "ok" : okCount > 0 ? "stale" : "offline");
}

function startOnexah() {
  refreshOnexah();
  if (!onexahTimer) {
    onexahTimer = window.setInterval(refreshOnexah, ONEXAH_REFRESH_MS);
  }
}

function stopOnexah() {
  if (onexahTimer) {
    window.clearInterval(onexahTimer);
    onexahTimer = null;
  }
}

/* ---------- Bootstrap ---------- */

async function bootstrapApp() {
  try {
    const [statusData, appData] = await Promise.all([
      fetchJson("/api/status"),
      fetchJson("/api/app")
    ]);

    renderApp(appData, statusData);
    await refreshAuthState();
  } catch (error) {
    renderError(error);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const yearEl = document.getElementById("footer-year");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  document.getElementById("toml-link")?.addEventListener("click", showToml);
  document.getElementById("login-button")?.addEventListener("click", startLogin);
  document.getElementById("logout-button")?.addEventListener("click", logout);
  document.getElementById("close-login-dialog")?.addEventListener("click", closeLoginDialog);
  document.getElementById("close-toml-dialog")?.addEventListener("click", closeTomlDialog);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopOnexah();
    } else {
      startOnexah();
    }
  });

  bootstrapApp();
  startOnexah();
});
