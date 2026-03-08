let currentAppData = null;
let authPollTimer = null;
let adminPollTimer = null;
let draggedTaskId = null;
const visibleBotOutputLimit = 20;
let currentBotOutputEntries = [];
let lastBotOutputRenderKey = "";
let currentView = "home";
let adminEditorState = null;

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

function setActiveNavTab(view) {
  const homeButton = document.getElementById("nav-home-button");
  const adminButton = document.getElementById("nav-admin-button");

  if (homeButton) {
    homeButton.classList.toggle("nav-tab-active", view === "home");
  }
  if (adminButton) {
    adminButton.classList.toggle("nav-tab-active", view === "admin");
  }
}

function setView(view, isOwner = false) {
  currentView = (view === "admin" && isOwner) ? "admin" : "home";
  showElement("home-page", currentView === "home");
  showElement("home-content", currentView === "home");
  showElement("admin-panel", currentView === "admin" && isOwner);
  setActiveNavTab(currentView);
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

function joinPolicyLines(values) {
  return Array.isArray(values) ? values.join("\n") : "";
}

function parsePolicyLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter(Boolean);
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
  setText("admin-account", adminData.ownerAccount);
  const controls = document.getElementById("admin-controls");
  if (controls) {
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

  const getTaskStatusTone = (task) => {
    if (task.recurring) {
      return "recurring";
    }
    const status = task.status;
    if (status === "running" || status === "completed") {
      return "running";
    }
    if (status === "failed") {
      return "failed";
    }
    if (status === "pending" || status === "waiting") {
      return "pending";
    }
    return "neutral";
  };

  container.innerHTML = tasks.map((task, index) => `
    <article class="bot-list-item bot-task-item bot-task-status-${getTaskStatusTone(task)} ${task.locked ? "bot-task-locked" : ""}" draggable="true" data-task-row-id="${escapeHtml(task.id)}">
      <div class="bot-task-heading">
        <span class="task-signal" aria-hidden="true"></span>
        <strong>#${index + 1} ${escapeHtml(task.title)}</strong>
      </div>
      <span>Status: ${escapeHtml(task.recurring ? "recurring" : task.status)}${task.locked ? " | Locked" : ""} | Attempts: ${escapeHtml(task.attempts)}</span>
      ${task.recurring ? `<span>Recurring every ${escapeHtml(task.recurringIntervalMinutes)} min${task.nextRecurringAt ? ` | Next run: ${escapeHtml(formatDateTime(task.nextRecurringAt))}` : ""}</span>` : ""}
      <span>Goal: ${escapeHtml(task.goal || "n/a")}</span>
      <p>${escapeHtml(task.assignedTaskBlock || "No assigned task block.")}</p>
      <div class="bot-list-item-actions">
        <button class="mini-button" type="button" data-task-edit="${escapeHtml(task.id)}">Edit</button>
        <button class="mini-button" type="button" data-task-lock="${escapeHtml(task.id)}" data-task-locked="${task.locked ? "true" : "false"}">${task.locked ? "Unlock" : "Lock"}</button>
        <button class="mini-button" type="button" data-task-recurring="${escapeHtml(task.id)}" data-task-recurring-enabled="${task.recurring ? "true" : "false"}">${task.recurring ? "Recurring On" : "Make Recurring"}</button>
        ${(task.status === "failed" || task.status === "completed" || task.status === "running") ? `<button class="mini-button" type="button" data-task-reset="${escapeHtml(task.id)}">Reset</button>` : ""}
        <button class="mini-button" type="button" data-task-delete="${escapeHtml(task.id)}">Delete</button>
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
        <button class="mini-button" type="button" data-goal-edit="${escapeHtml(goal.id)}">Edit</button>
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
      <div class="bot-list-item-actions">
        <button class="mini-button" type="button" data-note-remove="${escapeHtml(note.id)}">Delete</button>
      </div>
    </article>
  `).join("");
}

function renderConsoleList(entries) {
  const container = document.getElementById("bot-console-list");
  if (!container) {
    return;
  }

  if (!entries?.length) {
    container.textContent = "Console output will appear here.";
    return;
  }

  const orderedEntries = [...entries].reverse();
  container.innerHTML = orderedEntries.map((entry) => `
    <div class="bot-console-line">
      <span class="bot-console-time">${escapeHtml(formatDateTime(entry.createdAt))}</span>
      <span class="bot-console-message">${escapeHtml(entry.message || "")}</span>
      ${entry.meta && Object.keys(entry.meta).length ? `<code class="bot-console-meta">${escapeHtml(JSON.stringify(entry.meta))}</code>` : ""}
    </div>
  `).join("");
  container.scrollTop = container.scrollHeight;
}

function getBotOutputTitle(entry) {
  const firstLine = String(entry?.text || "").split("\n").find((line) => line.trim());
  return firstLine || "Bot output";
}

function getBotOutputBody(entry) {
  const lines = String(entry?.text || "").split("\n");
  const [, ...rest] = lines;
  const trimmedLines = [...rest];

  while (trimmedLines.length && !trimmedLines[0].trim()) {
    trimmedLines.shift();
  }

  if (trimmedLines.length) {
    const possibleTimestamp = trimmedLines[0].trim();
    const parsedTimestamp = new Date(possibleTimestamp);
    if (!Number.isNaN(parsedTimestamp.getTime())) {
      trimmedLines.shift();
    }
  }

  while (trimmedLines.length && !trimmedLines[0].trim()) {
    trimmedLines.shift();
  }

  const body = trimmedLines.join("\n").trim();
  return body || String(entry?.text || "");
}

function renderBotOutput(outputEntries) {
  const output = document.getElementById("ai-output");
  if (!output) {
    return;
  }

  if (!outputEntries?.length) {
    output.textContent = "Bot output will appear here.";
    return;
  }

  const visibleEntries = outputEntries.slice(0, visibleBotOutputLimit);
  const renderKey = visibleEntries.map((entry) => `${entry.createdAt}|${entry.source}|${entry.text}`).join("\n---\n");
  const alreadyRendered = Boolean(output.querySelector(".bot-output-list"));
  if (renderKey === lastBotOutputRenderKey && alreadyRendered) {
    currentBotOutputEntries = visibleEntries;
    return;
  }

  lastBotOutputRenderKey = renderKey;
  currentBotOutputEntries = visibleEntries;
  output.innerHTML = `
    <div class="bot-output-list">
      ${visibleEntries.map((entry, index) => `
        <article class="bot-output-entry">
          <div class="bot-output-entry-actions">
            <button class="mini-button" type="button" data-output-expand="${index}">Expand</button>
          </div>
          <strong class="bot-output-entry-title">${escapeHtml(getBotOutputTitle(entry))}</strong>
          <span class="bot-output-entry-time">${escapeHtml(formatDateTime(entry.createdAt))}</span>
          <pre class="bot-output-entry-body">${escapeHtml(getBotOutputBody(entry))}</pre>
        </article>
      `).join("")}
    </div>
  `;

  output.scrollTop = output.scrollHeight;
}

function openBotOutputDialog() {
  const dialog = document.getElementById("bot-output-dialog");
  if (dialog && typeof dialog.showModal === "function") {
    dialog.showModal();
  }
}

function closeBotOutputDialog() {
  const dialog = document.getElementById("bot-output-dialog");
  if (dialog) {
    dialog.classList.remove("dialog-maximized");
    dialog.close();
  }

  const toggleButton = document.getElementById("toggle-bot-output-dialog-size");
  if (toggleButton) {
    toggleButton.textContent = "Maximize";
  }
}

function expandBotOutputEntry(index) {
  const entry = currentBotOutputEntries[index];
  if (!entry) {
    return;
  }

  setText("bot-output-dialog-title", getBotOutputTitle(entry));
  setText("bot-output-dialog-time", formatDateTime(entry.createdAt));
  setText("bot-output-dialog-body", getBotOutputBody(entry));
  openBotOutputDialog();
}

function toggleBotOutputDialogSize() {
  const dialog = document.getElementById("bot-output-dialog");
  const toggleButton = document.getElementById("toggle-bot-output-dialog-size");
  if (!dialog || !toggleButton) {
    return;
  }

  const maximized = dialog.classList.toggle("dialog-maximized");
  toggleButton.textContent = maximized ? "Restore" : "Maximize";
}

function openAdminEditorDialog(config) {
  const dialog = document.getElementById("admin-editor-dialog");
  const nameWrap = document.getElementById("admin-editor-name-wrap");
  const nameInput = document.getElementById("admin-editor-name");
  const goalWrap = document.getElementById("admin-editor-goal-wrap");
  const goalInput = document.getElementById("admin-editor-goal");
  const recurringWrap = document.getElementById("admin-editor-recurring-wrap");
  const recurringInput = document.getElementById("admin-editor-recurring");
  const recurringIntervalInput = document.getElementById("admin-editor-recurring-interval");
  const bodyInput = document.getElementById("admin-editor-body");

  adminEditorState = config;
  setText("admin-editor-kicker", config.kicker || "Admin Edit");
  setText("admin-editor-title", config.title || "Edit item");
  setText("admin-editor-name-label", config.nameLabel || "Title");
  setText("admin-editor-body-label", config.bodyLabel || "Body");

  if (nameWrap) {
    nameWrap.classList.toggle("hidden", config.showName === false);
  }
  if (nameInput) {
    nameInput.value = config.nameValue || "";
    nameInput.placeholder = config.namePlaceholder || "";
  }
  if (goalInput) {
    goalInput.value = config.goalValue || "";
    goalInput.placeholder = config.goalPlaceholder || "";
  }
  if (recurringWrap) {
    recurringWrap.classList.toggle("hidden", !config.showRecurring);
  }
  if (recurringInput) {
    recurringInput.checked = Boolean(config.recurringValue);
  }
  if (recurringIntervalInput) {
    recurringIntervalInput.value = config.recurringIntervalValue || "";
    recurringIntervalInput.placeholder = config.recurringIntervalPlaceholder || "60";
  }
  if (bodyInput) {
    bodyInput.value = config.bodyValue || "";
    bodyInput.placeholder = config.bodyPlaceholder || "";
  }
  if (goalWrap) {
    goalWrap.classList.toggle("hidden", !config.showGoal);
  }

  if (dialog && typeof dialog.showModal === "function") {
    dialog.showModal();
  }
}

function closeAdminEditorDialog() {
  const dialog = document.getElementById("admin-editor-dialog");
  adminEditorState = null;
  if (dialog) {
    dialog.close();
  }
}

async function saveAdminEditorDialog() {
  if (!adminEditorState) {
    return;
  }

  const nameInput = document.getElementById("admin-editor-name");
  const goalInput = document.getElementById("admin-editor-goal");
  const recurringInput = document.getElementById("admin-editor-recurring");
  const recurringIntervalInput = document.getElementById("admin-editor-recurring-interval");
  const bodyInput = document.getElementById("admin-editor-body");
  const payload = adminEditorState.buildPayload({
    name: nameInput?.value || "",
    goal: goalInput?.value || "",
    recurring: Boolean(recurringInput?.checked),
    recurringIntervalMinutes: Number(recurringIntervalInput?.value || 60),
    body: bodyInput?.value || ""
  });

  await fetchJson(adminEditorState.url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  closeAdminEditorDialog();
  setText("ai-output", adminEditorState.successMessage || "Saved.");
  await refreshOwnerData();
}

function renderBot(botData) {
  if (!botData) {
    return;
  }

  const runtimeStatus = botData.state.isRunning
    ? (botData.config.enabled ? "Running" : "Stopping after current run")
    : botData.config.enabled
      ? (botData.config.pauseWhenQueueEmpty && !botData.state.nextRunAt ? "Paused waiting for work" : "Loop enabled")
      : "Stopped";
  setText("bot-runtime-status", runtimeStatus);
  setText("bot-git-branch", botData.git?.available ? `${botData.git.branch} (${botData.git.dirty ? "dirty" : "clean"})` : "Git unavailable");
  setText("bot-next-run", botData.state.nextRunAt ? formatDateTime(botData.state.nextRunAt) : (botData.config.enabled && botData.config.pauseWhenQueueEmpty ? "Paused until new task" : "-"));
  setText("bot-last-result", botData.state.lastResult || botData.state.lastError || "-");
  setText("bot-last-error", botData.state.lastError || "-");
  renderBotOutput(botData.state.botOutputEntries || []);

  const idleDelay = document.getElementById("bot-idle-delay");
  const postTaskDelay = document.getElementById("bot-post-task-delay");
  const retryDelay = document.getElementById("bot-retry-delay");
  const maxRuntime = document.getElementById("bot-max-runtime");
  const maxRetries = document.getElementById("bot-max-retries");
  const recurringInterval = document.getElementById("bot-recurring-interval");
  const enabled = document.getElementById("bot-enabled");
  const pauseWhenEmpty = document.getElementById("bot-pause-empty");
  const autoCall = document.getElementById("bot-auto-call");
  const autoCommit = document.getElementById("bot-auto-commit");
  const autoPush = document.getElementById("bot-auto-push");
  const writableRoots = document.getElementById("bot-writable-roots");
  const protectedPaths = document.getElementById("bot-protected-paths");

  if (idleDelay) {
    idleDelay.value = botData.config.idleDelaySeconds;
  }
  if (postTaskDelay) {
    postTaskDelay.value = botData.config.postTaskDelaySeconds;
  }
  if (retryDelay) {
    retryDelay.value = botData.config.retryDelaySeconds;
  }
  if (maxRuntime) {
    maxRuntime.value = botData.config.maxTaskRuntimeMinutes;
  }
  if (maxRetries) {
    maxRetries.value = botData.config.maxRetries;
  }
  if (recurringInterval) {
    recurringInterval.value = botData.config.recurringTaskIntervalMinutes ?? 60;
  }
  if (enabled) {
    enabled.checked = Boolean(botData.config.enabled);
  }
  if (pauseWhenEmpty) {
    pauseWhenEmpty.checked = Boolean(botData.config.pauseWhenQueueEmpty);
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
  if (writableRoots) {
    writableRoots.value = joinPolicyLines(botData.config.writableRoots);
  }
  if (protectedPaths) {
    protectedPaths.value = joinPolicyLines(botData.config.protectedPaths);
  }

  renderTaskList(botData.tasks || []);
  renderGoalList(botData.goals || []);
  renderNoteList(botData.notes || []);
  renderConsoleList(botData.state.consoleEntries || []);
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
  showElement("nav-admin-button", auth.isOwner);

  const loginButton = document.getElementById("login-button");
  if (loginButton) {
    loginButton.disabled = !auth.configured || auth.loggedIn;
    loginButton.textContent = auth.configured ? "Login with Xaman" : "Xaman not configured";
  }

  if (!auth.isOwner && currentView === "admin") {
    setView("home", false);
  } else {
    setView(currentView, auth.isOwner);
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
    pauseWhenQueueEmpty: document.getElementById("bot-pause-empty")?.checked,
    autoCallLlm: document.getElementById("bot-auto-call")?.checked,
    autoCommit: document.getElementById("bot-auto-commit")?.checked,
    autoPush: document.getElementById("bot-auto-push")?.checked,
    idleDelaySeconds: Number(document.getElementById("bot-idle-delay")?.value || 45),
    postTaskDelaySeconds: Number(document.getElementById("bot-post-task-delay")?.value || 15),
    retryDelaySeconds: Number(document.getElementById("bot-retry-delay")?.value || 90),
    maxTaskRuntimeMinutes: Number(document.getElementById("bot-max-runtime")?.value || 20),
    maxRetries: Number(document.getElementById("bot-max-retries")?.value || 2),
    recurringTaskIntervalMinutes: Number(document.getElementById("bot-recurring-interval")?.value || 60),
    writableRoots: parsePolicyLines(document.getElementById("bot-writable-roots")?.value),
    protectedPaths: parsePolicyLines(document.getElementById("bot-protected-paths")?.value)
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

async function resetTask(taskId) {
  await fetchJson(`/api/admin/bot/tasks/${taskId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ reset: true })
  });

  setText("ai-output", "Task reset to waiting and marked for rerun.");
  await refreshOwnerData();
}

async function toggleRecurringTask(taskId, recurring) {
  const botData = await fetchJson("/api/admin/bot");
  const task = (botData.tasks || []).find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  const fallbackInterval = Number(document.getElementById("bot-recurring-interval")?.value || botData.config?.recurringTaskIntervalMinutes || 60);

  await fetchJson(`/api/admin/bot/tasks/${taskId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      recurring,
      recurringIntervalMinutes: task.recurringIntervalMinutes || fallbackInterval
    })
  });

  setText("ai-output", recurring ? "Task marked recurring." : "Task set back to one-shot mode.");
  await refreshOwnerData();
}

async function toggleTaskLock(taskId, locked) {
  await fetchJson(`/api/admin/bot/tasks/${taskId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ locked })
  });

  setText("ai-output", locked ? "Task locked." : "Task unlocked.");
  await refreshOwnerData();
}

async function deleteTask(taskId) {
  await fetchJson(`/api/admin/bot/tasks/${taskId}`, {
    method: "DELETE"
  });

  setText("ai-output", "Task deleted.");
  await refreshOwnerData();
}

async function reorderTaskList(taskIds) {
  await fetchJson("/api/admin/bot/tasks/reorder", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ taskIds })
  });

  setText("ai-output", "Task order updated.");
  await refreshOwnerData();
}

async function editTask(taskId) {
  const botData = await fetchJson("/api/admin/bot");
  const task = (botData.tasks || []).find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error("Task not found");
  }
  openAdminEditorDialog({
    kicker: "Task Edit",
    title: "Edit task",
    showName: true,
    nameLabel: "Task title",
    namePlaceholder: "Enter task title",
    nameValue: task.title || "",
    showGoal: true,
    goalValue: task.goal || "",
    goalPlaceholder: "Describe the task goal",
    showRecurring: true,
    recurringValue: Boolean(task.recurring),
    recurringIntervalValue: task.recurringIntervalMinutes || 60,
    recurringIntervalPlaceholder: "Recurring minutes",
    bodyLabel: "Assigned task block",
    bodyPlaceholder: "Enter the assigned work block",
    bodyValue: task.assignedTaskBlock || "",
    url: `/api/admin/bot/tasks/${taskId}`,
    successMessage: "Task edited.",
    buildPayload: ({ name, goal, recurring, recurringIntervalMinutes, body }) => ({
      title: name,
      goal,
      recurring,
      recurringIntervalMinutes,
      assignedTaskBlock: body
    })
  });
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

async function editGoal(goalId) {
  const botData = await fetchJson("/api/admin/bot");
  const goal = (botData.goals || []).find((entry) => entry.id === goalId);
  if (!goal) {
    throw new Error("Goal not found");
  }
  openAdminEditorDialog({
    kicker: "Goal Edit",
    title: "Edit goal",
    showName: false,
    showGoal: false,
    showRecurring: false,
    bodyLabel: "Goal",
    bodyPlaceholder: "Describe the goal",
    bodyValue: goal.text || "",
    url: `/api/admin/bot/goals/${goalId}`,
    successMessage: "Goal edited.",
    buildPayload: ({ body }) => ({
      text: body
    })
  });
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

async function removeNote(noteId) {
  await fetchJson(`/api/admin/bot/notes/${noteId}`, {
    method: "DELETE"
  });

  setText("ai-output", "Note deleted.");
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
  const homeNavButton = document.getElementById("nav-home-button");
  const adminNavButton = document.getElementById("nav-admin-button");
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
  const noteList = document.getElementById("bot-note-list");
  const outputList = document.getElementById("ai-output");
  const loginButton = document.getElementById("login-button");
  const logoutButton = document.getElementById("logout-button");
  const closeButton = document.getElementById("close-login-dialog");
  const closeTomlButton = document.getElementById("close-toml-dialog");
  const closeBotOutputButton = document.getElementById("close-bot-output-dialog");
  const toggleBotOutputSizeButton = document.getElementById("toggle-bot-output-dialog-size");
  const adminEditorDialog = document.getElementById("admin-editor-dialog");
  const adminEditorCancelButton = document.getElementById("admin-editor-cancel");
  const adminEditorSaveButton = document.getElementById("admin-editor-save");

  setView("home", false);

  if (homeNavButton) {
    homeNavButton.addEventListener("click", () => {
      setView("home", !document.getElementById("nav-admin-button")?.classList.contains("hidden"));
    });
  }
  if (adminNavButton) {
    adminNavButton.addEventListener("click", async () => {
      const auth = await fetchJson("/api/auth/session");
      if (auth.isOwner) {
        setView("admin", true);
      }
    });
  }

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
    taskList.addEventListener("dragstart", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const taskId = target.dataset.taskRowId;
      if (!taskId) {
        return;
      }

      draggedTaskId = taskId;
      target.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", taskId);
      }
    });

    taskList.addEventListener("dragend", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        target.classList.remove("dragging");
      }

      draggedTaskId = null;
      taskList.querySelectorAll(".drag-over").forEach((element) => {
        element.classList.remove("drag-over");
      });
    });

    taskList.addEventListener("dragover", (event) => {
      event.preventDefault();
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const row = target.closest("[data-task-row-id]");
      if (!(row instanceof HTMLElement) || !draggedTaskId || row.dataset.taskRowId === draggedTaskId) {
        return;
      }

      taskList.querySelectorAll(".drag-over").forEach((element) => {
        element.classList.remove("drag-over");
      });
      row.classList.add("drag-over");
    });

    taskList.addEventListener("drop", async (event) => {
      event.preventDefault();
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const row = target.closest("[data-task-row-id]");
      if (!(row instanceof HTMLElement) || !draggedTaskId) {
        return;
      }

      const rows = [...taskList.querySelectorAll("[data-task-row-id]")];
      const fromIndex = rows.findIndex((element) => element.dataset.taskRowId === draggedTaskId);
      const toIndex = rows.findIndex((element) => element.dataset.taskRowId === row.dataset.taskRowId);

      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
        return;
      }

      const taskIds = rows.map((element) => element.dataset.taskRowId);
      const [moved] = taskIds.splice(fromIndex, 1);
      taskIds.splice(toIndex, 0, moved);

      await reorderTaskList(taskIds);
    });

    taskList.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const editTaskId = target.dataset.taskEdit;
      const lockTaskId = target.dataset.taskLock;
      const recurringTaskId = target.dataset.taskRecurring;
      const resetTaskId = target.dataset.taskReset;
      const deleteTaskId = target.dataset.taskDelete;
      const taskId = target.dataset.taskId;
      const action = target.dataset.taskAction;
      if (editTaskId) {
        await editTask(editTaskId);
        return;
      }
      if (lockTaskId) {
        await toggleTaskLock(lockTaskId, target.dataset.taskLocked !== "true");
        return;
      }
      if (recurringTaskId) {
        await toggleRecurringTask(recurringTaskId, target.dataset.taskRecurringEnabled !== "true");
        return;
      }
      if (resetTaskId) {
        await resetTask(resetTaskId);
        return;
      }
      if (deleteTaskId) {
        await deleteTask(deleteTaskId);
        return;
      }
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

      const editGoalId = target.dataset.goalEdit;
      const goalId = target.dataset.goalRemove;
      if (editGoalId) {
        await editGoal(editGoalId);
        return;
      }
      if (goalId) {
        await removeGoal(goalId);
      }
    });
  }
  if (noteList) {
    noteList.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const noteId = target.dataset.noteRemove;
      if (noteId) {
        await removeNote(noteId);
      }
    });
  }
  if (outputList) {
    outputList.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const outputIndex = target.dataset.outputExpand;
      if (outputIndex) {
        expandBotOutputEntry(Number(outputIndex));
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
  if (closeBotOutputButton) {
    closeBotOutputButton.addEventListener("click", closeBotOutputDialog);
  }
  if (toggleBotOutputSizeButton) {
    toggleBotOutputSizeButton.addEventListener("click", toggleBotOutputDialogSize);
  }
  if (adminEditorCancelButton) {
    adminEditorCancelButton.addEventListener("click", closeAdminEditorDialog);
  }
  if (adminEditorSaveButton) {
    adminEditorSaveButton.addEventListener("click", saveAdminEditorDialog);
  }
  if (adminEditorDialog) {
    adminEditorDialog.addEventListener("cancel", () => {
      adminEditorState = null;
    });
  }

  bootstrapApp();
});
