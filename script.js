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

/* ── home page cluster pane ───────────────────────────────────────────────
 * Fails quietly on purpose: the pane is a nice-to-have on a page whose job is
 * the brand. If the cluster is unreachable the section hides itself rather
 * than showing a broken card on the front page. */
function clusterTile(label, value, note, tone) {
  return `<div class="cluster-tile" data-tone="${tone || ""}">
    <span class="cluster-tile-label">${escapeHtml(label)}</span>
    <span class="cluster-tile-value">${escapeHtml(value)}</span>
    <span class="cluster-tile-note">${escapeHtml(note || "")}</span>
  </div>`;
}

async function renderClusterPane() {
  const section = document.getElementById("cluster-pane-section");
  if (!section) return;
  try {
    const d = await fetchJson("/api/cluster");
    const tone = d.health === "ok" ? "ok" : d.health === "degraded" ? "warn" : "bad";
    const nfmt = (v) => (typeof v === "number" ? v.toLocaleString() : "—");

    const badges = document.getElementById("home-cluster-badges");
    if (badges) {
      badges.innerHTML =
        `<span class="pill ${tone}">${escapeHtml(d.health)}</span>` +
        `<span class="pill">${escapeHtml(d.network)}</span>`;
    }
    const tiles = document.getElementById("home-cluster-tiles");
    if (tiles) {
      tiles.innerHTML = [
        clusterTile("Nodes online", `${d.nodesUp}/${d.nodesTotal}`, "clustered", tone),
        clusterTile("Validated ledger", nfmt(d.validatedSeq), "latest"),
        clusterTile("History", nfmt(d.historyLedgers), "ledgers available"),
        clusterTile("Peers", nfmt(d.peers), "network connections")
      ].join("");
    }
    section.hidden = false;
  } catch (_error) {
    section.hidden = true;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  renderClusterPane();
  setInterval(renderClusterPane, 30000);
  const yearEl = document.getElementById("footer-year");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  document.getElementById("toml-link")?.addEventListener("click", showToml);
  document.getElementById("login-button")?.addEventListener("click", startLogin);
  document.getElementById("logout-button")?.addEventListener("click", logout);
  document.getElementById("close-login-dialog")?.addEventListener("click", closeLoginDialog);
  document.getElementById("close-toml-dialog")?.addEventListener("click", closeTomlDialog);

  bootstrapApp();
});
