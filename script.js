let currentAppData = null;
let authPollTimer = null;
let adminPollTimer = null;

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

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function renderModules(modules) {
  const container = document.getElementById("modules-list");
  if (!container) {
    return;
  }

  container.innerHTML = modules.map((module) => `
    <article class="module-card">
      <h3>${escapeHtml(module.name)}</h3>
      <p>${escapeHtml(module.description)}</p>
      <span class="module-status module-status-${escapeHtml(module.status.toLowerCase())}">${escapeHtml(module.status)}</span>
    </article>
  `).join("");
}

function renderLinks(links) {
  const container = document.getElementById("links-list");
  if (!container) {
    return;
  }

  container.innerHTML = links.map((link) => {
    const displayValue = String(link.href || "").replace(/^mailto:/, "");

    return `
      <div class="link-card link-card-static">
        <div>
          <strong>${escapeHtml(link.label)}</strong>
          <span class="link-value">${escapeHtml(displayValue)}</span>
        </div>
      </div>
    `;
  }).join("");
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

function renderAdmin(adminData, botData) {
  const controls = document.getElementById("admin-controls");
  if (controls) {
    setText("admin-account", adminData.ownerAccount);
    controls.innerHTML = adminData.controls.map((control) => `
      <span class="admin-control-pill">${escapeHtml(control)}</span>
    `).join("");
  }

  renderAdminAi(adminData.ai);
  renderBot(botData);
}

function renderAdminAi(aiData) {
  const files = document.getElementById("ai-files");
  if (!aiData) {
    return;
  }

  setText("ai-config-status", aiData.configured ? "OpenAI key ready" : "OpenAI key missing");
  setText("ai-manifest-name", `${aiData.manifest.name} v${aiData.manifest.version}`);
  setText("ai-exec-mode", aiData.execMode);

  if (files) {
    files.innerHTML = Object.entries(aiData.files).map(([label, filePath]) => `
      <span class="admin-control-pill">${escapeHtml(label)}: ${escapeHtml(filePath)}</span>
    `).join("");
  }
}

function renderTaskList(tasks) {
  const container = document.getElementById("bot-task-list");
  if (!container) {
    return;
  }

  if (!tasks.length) {
    container.innerHTML = `<div class="bot-list-item"><span>No tasks queued.</span></div>`;
    return;
  }

  container.innerHTML = tasks.map((task) => `
    <article class="bot-list-item">
      <strong>${escapeHtml(task.title)}</strong>
      <span>Status: ${escapeHtml(task.status)} | Attempts: ${escapeHtml(task.attempts)}</span>
      <span>Goal: ${escapeHtml(task.goal || "n/a")}</span>
      <p>${escapeHtml(task.assignedTaskBlock || "No assigned task block.")}</p>
      ${task.lastError ? `<span>Last error: ${escapeHtml(task.lastError)}</span>` : ""}
      ${task.lastOutput ? `<span>Last output: ${escapeHtml(task.lastOutput)}</span>` : ""}
      <div class="bot-list-item-actions">
        <button class="mini-button" type="button" data-task-action="pending" data-task-id="${escapeHtml(task.id)}">Queue</button>
        <button class="mini-button" type="button" data-task-action="completed" data-task-id="${escapeHtml(task.id)}">Complete</button>
        <button class="mini-button" type="button" data-task-action="failed" data-task-id="${escapeHtml(task.id)}">Fail</button>
      </div>
    </article>
  `).join("");
}

function renderGoalList(goals) {
  const container = document.getElementById("bot-goal-list");
  if (!container) {
    return;
  }

  if (!goals.length) {
    container.innerHTML = `<div class="bot-list-item"><span>No persistent goals set.</span></div>`;
    return;
  }

  container.innerHTML = goals.map((goal) => `
    <article class="bot-list-item">
      <strong>${escapeHtml(goal.text)}</strong>
      <span>${escapeHtml(formatDateTime(goal.createdAt))}</span>
      <div class="bot-list-item-actions">
        <button class="mini-button" type="button" data-goal-remove="${escapeHtml(goal.id)}">Remove</button>
      </div>
    </article>
  `).join("");
}

function renderNoteList(notes) {
  const container = document.getElementById("bot-note-list");
  if (!container) {
    return;
  }

  if (!notes.length) {
    container.innerHTML = `<div class="bot-list-item"><span>No notes yet.</span></div>`;
    return;
  }

  container.innerHTML = notes.map((note) => `
    <article class="bot-list-item">
      <strong>${escapeHtml(note.title)}</strong>
      <span>${escapeHtml(formatDateTime(note.createdAt))}</span>
      <p>${escapeHtml(note.body)}</p>
    </article>
  `).join("");
}

function renderActivityList(activity) {
  const container = document.getElementById("bot-activity-list");
  if (!container) {
    return;
  }

  if (!activity.length) {
    container.innerHTML = `<div class="bot-list-item"><span>No activity yet.</span></div>`;
    return;
  }

  container.innerHTML = activity.map((entry) => `
    <article class="bot-list-item">
      <strong>${escapeHtml(entry.type)}</strong>
      <span>${escapeHtml(formatDateTime(entry.createdAt))}</span>
      <p>${escapeHtml(entry.message)}</p>
    </article>
  `).join("");
}

function renderBot(botData) {
  if (!botData) {
    return;
  }

  setText("bot-runtime-status", botData.config.enabled ? "Loop enabled" : "Loop disabled");
  setText("bot-git-branch", botData.git?.available ? `${botData.git.branch} (${botData.git.dirty ? "dirty" : "clean"})` : "Git unavailable");
  setText("bot-next-run", formatDateTime(botData.state.nextRunAt));
  setText("bot-last-result", botData.state.lastResult || botData.state.lastError || "-");

  const loopMinutes = document.getElementById("bot-loop-minutes");
  const idleDelay = document.getElementById("bot-idle-delay");
  const maxRetries = document.getElementById("bot-max-retries");
  const enabled = document.getElementById("bot-enabled");
  const autoCall = document.getElementById("bot-auto-call");
  const autoCommit = document.getElementById("bot-auto-commit");
  const autoPush = document.getElementById("bot-auto-push");

  if (loopMinutes) {
    loopMinutes.value = botData.config.loopMinutes;
  }
  if (idleDelay) {
    idleDelay.value = botData.config.idleDelaySeconds;
  }
  if (maxRetries) {
    maxRetries.value = botData.config.maxRetries;
  }
  if (enabled) {
    enabled.checked = Boolean(botData.config.enabled);
  }
  if (autoCall) {
    autoCall.checked = Boolean(botData.config.autoCallLlm);
  }
  if (autoCommit) {
    autoCommit.checked = Boolean(botData.config.autoCommit);
  }
  if (autoPush) {
    autoPush.checked = Boolean(botData.config.autoPush);
  }

  renderTaskList(botData.tasks || []);
  renderGoalList(botData.goals || []);
  renderNoteList(botData.notes || []);
  renderActivityList(botData.activity || []);
}

function startAdminPolling() {
  if (adminPollTimer) {
    return;
  }

  adminPollTimer = window.setInterval(async () => {
    try {
      await refreshOwnerData();
    } catch (error) {
      setText("ai-output", error.message);
    }
  }, 10000);
}

function stopAdminPolling() {
  if (adminPollTimer) {
    window.clearInterval(adminPollTimer);
    adminPollTimer = null;
  }
}

async function refreshOwnerData() {
  const [adminData, botData] = await Promise.all([
    fetchJson("/api/admin"),
    fetchJson("/api/admin/bot")
  ]);

  renderAdmin(adminData, botData);
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
    await refreshOwnerData();
    startAdminPolling();
  } else {
    stopAdminPolling();
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
  setHref("unl-link", appData.validator.unlUrl);
  setHref("toml-source-link", appData.validator.tomlUrl);

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
  setText("toml-message", "Loading TOML...");
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
    setText("toml-message", "Live viewer for the validator TOML file.");
  } catch (error) {
    setText("toml-message", error.message);
  }
}

async function runAdminAi() {
  const promptInput = document.getElementById("ai-prompt");
  const runButton = document.getElementById("ai-run-button");
  const output = document.getElementById("ai-output");

  if (!promptInput || !runButton || !output) {
    return;
  }

  runButton.disabled = true;
  output.textContent = "Running manual admin AI call...";

  try {
    const result = await fetchJson("/api/admin/ai/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: promptInput.value
      })
    });

    output.textContent = result.output;
    await refreshOwnerData();
  } catch (error) {
    output.textContent = error.message;
  } finally {
    runButton.disabled = false;
  }
}

async function saveBotConfig() {
  const payload = {
    enabled: document.getElementById("bot-enabled")?.checked,
    autoCallLlm: document.getElementById("bot-auto-call")?.checked,
    autoCommit: document.getElementById("bot-auto-commit")?.checked,
    autoPush: document.getElementById("bot-auto-push")?.checked,
    loopMinutes: Number(document.getElementById("bot-loop-minutes")?.value || 15),
    idleDelaySeconds: Number(document.getElementById("bot-idle-delay")?.value || 45),
    maxRetries: Number(document.getElementById("bot-max-retries")?.value || 2)
  };

  await fetchJson("/api/admin/bot/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  setText("ai-output", "Bot config saved.");
  await refreshOwnerData();
}

async function startBotLoop() {
  await fetchJson("/api/admin/bot/start", { method: "POST" });
  setText("ai-output", "Bot loop started.");
  await refreshOwnerData();
}

async function stopBotLoop() {
  await fetchJson("/api/admin/bot/stop", { method: "POST" });
  setText("ai-output", "Bot loop stopped.");
  await refreshOwnerData();
}

async function runBotNow() {
  setText("ai-output", "Running bot cycle...");
  const result = await fetchJson("/api/admin/bot/run", { method: "POST" });
  setText("ai-output", result.state?.lastResult || result.state?.lastError || "Bot cycle finished.");
  await refreshOwnerData();
}

async function addTask() {
  const title = document.getElementById("task-title");
  const goal = document.getElementById("task-goal");
  const block = document.getElementById("task-block");

  await fetchJson("/api/admin/bot/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: title?.value,
      goal: goal?.value,
      assignedTaskBlock: block?.value
    })
  });

  if (title) {
    title.value = "";
  }
  if (goal) {
    goal.value = "";
  }
  if (block) {
    block.value = "";
  }

  setText("ai-output", "Task added.");
  await refreshOwnerData();
}

async function updateTaskStatus(taskId, status) {
  await fetchJson(`/api/admin/bot/tasks/${taskId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status })
  });

  setText("ai-output", `Task updated to ${status}.`);
  await refreshOwnerData();
}

async function addGoal() {
  const goalInput = document.getElementById("goal-text");

  await fetchJson("/api/admin/bot/goals", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: goalInput?.value
    })
  });

  if (goalInput) {
    goalInput.value = "";
  }

  setText("ai-output", "Goal added.");
  await refreshOwnerData();
}

async function removeGoal(goalId) {
  await fetchJson(`/api/admin/bot/goals/${goalId}`, {
    method: "DELETE"
  });

  setText("ai-output", "Goal removed.");
  await refreshOwnerData();
}

async function addNote() {
  const title = document.getElementById("note-title");
  const body = document.getElementById("note-body");

  await fetchJson("/api/admin/bot/notes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: title?.value,
      body: body?.value
    })
  });

  if (title) {
    title.value = "";
  }
  if (body) {
    body.value = "";
  }

  setText("ai-output", "Note saved.");
  await refreshOwnerData();
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

  stopAdminPolling();
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
  const tomlButton = document.getElementById("toml-link");
  const aiRunButton = document.getElementById("ai-run-button");
  const botSaveConfigButton = document.getElementById("bot-save-config");
  const botStartButton = document.getElementById("bot-start-button");
  const botStopButton = document.getElementById("bot-stop-button");
  const botRunNowButton = document.getElementById("bot-run-now");
  const taskAddButton = document.getElementById("task-add-button");
  const goalAddButton = document.getElementById("goal-add-button");
  const noteAddButton = document.getElementById("note-add-button");
  const taskList = document.getElementById("bot-task-list");
  const goalList = document.getElementById("bot-goal-list");
  const loginButton = document.getElementById("login-button");
  const logoutButton = document.getElementById("logout-button");
  const closeButton = document.getElementById("close-login-dialog");
  const closeTomlButton = document.getElementById("close-toml-dialog");

  if (tomlButton) {
    tomlButton.addEventListener("click", showToml);
  }
  if (aiRunButton) {
    aiRunButton.addEventListener("click", runAdminAi);
  }
  if (botSaveConfigButton) {
    botSaveConfigButton.addEventListener("click", saveBotConfig);
  }
  if (botStartButton) {
    botStartButton.addEventListener("click", startBotLoop);
  }
  if (botStopButton) {
    botStopButton.addEventListener("click", stopBotLoop);
  }
  if (botRunNowButton) {
    botRunNowButton.addEventListener("click", runBotNow);
  }
  if (taskAddButton) {
    taskAddButton.addEventListener("click", addTask);
  }
  if (goalAddButton) {
    goalAddButton.addEventListener("click", addGoal);
  }
  if (noteAddButton) {
    noteAddButton.addEventListener("click", addNote);
  }
  if (taskList) {
    taskList.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const taskId = target.dataset.taskId;
      const action = target.dataset.taskAction;
      if (taskId && action) {
        await updateTaskStatus(taskId, action);
      }
    });
  }
  if (goalList) {
    goalList.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const goalId = target.dataset.goalRemove;
      if (goalId) {
        await removeGoal(goalId);
      }
    });
  }
  if (loginButton) {
    loginButton.addEventListener("click", startLogin);
  }
  if (logoutButton) {
    logoutButton.addEventListener("click", logout);
  }
  if (closeButton) {
    closeButton.addEventListener("click", closeLoginDialog);
  }
  if (closeTomlButton) {
    closeTomlButton.addEventListener("click", closeTomlDialog);
  }

  bootstrapApp();
});
