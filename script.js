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

function renderModules(modules) {
  const container = document.getElementById("modules-list");
  if (!container) {
    return;
  }

  container.innerHTML = modules.map((module) => `
    <article class="module-card">
      <h3>${module.name}</h3>
      <p>${module.description}</p>
      <span class="module-status module-status-${module.status.toLowerCase()}">${module.status}</span>
    </article>
  `).join("");
}

function renderLinks(links) {
  const container = document.getElementById("links-list");
  if (!container) {
    return;
  }

  container.innerHTML = links.map((link) => `
    <a class="link-card" href="${link.href}" target="_blank" rel="noreferrer">
      <div>
        <strong>${link.label}</strong>
        <span>${link.href}</span>
      </div>
      <span class="link-arrow">+</span>
    </a>
  `).join("");
}

function renderHeroLinks(links) {
  const email = links.find((link) => link.label === "Email");
  const twitter = links.find((link) => link.label === "Twitter");
  const github = links.find((link) => link.label === "GitHub");

  if (email) {
    setHref("hero-email-link", email.href);
  }

  if (twitter) {
    setHref("hero-twitter-link", twitter.href);
  }

  if (github) {
    setHref("hero-github-link", github.href);
  }
}

function renderAdmin(adminData) {
  const controls = document.getElementById("admin-controls");
  if (!controls) {
    return;
  }

  setText("admin-account", adminData.ownerAccount);
  controls.innerHTML = adminData.controls.map((control) => `
    <span class="admin-control-pill">${control}</span>
  `).join("");
}

async function refreshAuthState() {
  const auth = await fetchJson("/api/auth/session");
  const authChipText = auth.loggedIn
    ? auth.isOwner
      ? `Owner ${auth.account}`
      : `Signed in ${auth.account}`
    : auth.configured
      ? "Signed out"
      : "Xaman keys missing";

  setText("auth-chip", authChipText);
  showElement("logout-button", auth.loggedIn);
  showElement("admin-panel", auth.isOwner);

  const loginButton = document.getElementById("login-button");
  if (loginButton) {
    loginButton.disabled = !auth.configured || auth.loggedIn;
    loginButton.textContent = auth.configured ? "Login with Xaman" : "Xaman not configured";
  }

  if (auth.isOwner) {
    const adminData = await fetchJson("/api/admin");
    renderAdmin(adminData);
  }
}

function renderApp(appData, statusData) {
  currentAppData = appData;
  setText("nav-brand", "XRPL / XAHAU control surface");
  setText("brand-name", appData.brand.name);
  setText("brand-tagline", appData.brand.tagline);
  setText("brand-summary", appData.brand.summary);
  setText("status-pill", `${appData.validator.status} / ${statusData.environment}`);
  setText("validator-network", `${appData.validator.network} (${appData.validator.networkId})`);
  setText("validator-account", appData.validator.account);
  setText("validator-location", appData.validator.location);
  setText("validator-key", appData.validator.publicKey);
  setText("api-status", statusData.ok ? "Online" : "Offline");
  setText("api-updated", new Date(statusData.timestamp).toLocaleString());
  setHref("toml-link", appData.validator.tomlUrl);
  setHref("unl-link", appData.validator.unlUrl);

  const logo = document.getElementById("brand-logo");
  const navLogo = document.getElementById("nav-logo");
  if (logo) {
    logo.src = appData.brand.logo;
  }
  if (navLogo) {
    navLogo.src = appData.brand.logo;
  }

  renderModules(appData.modules);
  renderHeroLinks(appData.links);
  renderLinks(appData.links);
}

function renderError(error) {
  setText("brand-name", "API unavailable");
  setText("brand-summary", error.message);
  setText("api-status", "Offline");
}

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

async function startLogin() {
  const qr = document.getElementById("login-qr");
  const openLink = document.getElementById("login-open-link");

  openLoginDialog();
  setText("login-message", "Creating Xaman sign-in request...");
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

    setText("login-message", `Sign with Xaman. Only ${currentAppData.auth.ownerAccount} will unlock admin.`);

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
  const loginButton = document.getElementById("login-button");
  const logoutButton = document.getElementById("logout-button");
  const closeButton = document.getElementById("close-login-dialog");

  if (loginButton) {
    loginButton.addEventListener("click", startLogin);
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", logout);
  }

  if (closeButton) {
    closeButton.addEventListener("click", closeLoginDialog);
  }

  bootstrapApp();
});
