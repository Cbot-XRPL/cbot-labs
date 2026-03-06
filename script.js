async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
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

function renderModules(modules) {
  const container = document.getElementById("modules-list");
  if (!container) {
    return;
  }

  container.innerHTML = modules.map((module) => `
    <article class="module-card">
      <h3>${module.name}</h3>
      <p>${module.description}</p>
      <span class="module-status">${module.status}</span>
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

function renderApp(appData, statusData) {
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
  if (logo) {
    logo.src = appData.brand.logo;
  }

  renderModules(appData.modules);
  renderLinks(appData.links);
}

function renderError(error) {
  setText("brand-name", "API unavailable");
  setText("brand-summary", error.message);
  setText("api-status", "Offline");
}

async function bootstrapApp() {
  try {
    const [statusData, appData] = await Promise.all([
      fetchJson("/api/status"),
      fetchJson("/api/app")
    ]);

    renderApp(appData, statusData);
  } catch (error) {
    renderError(error);
  }
}

window.addEventListener("DOMContentLoaded", bootstrapApp);
