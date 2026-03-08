const tabButtons = document.querySelectorAll("[data-tab-target]");
const tabPanes = document.querySelectorAll(".tab-pane");

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const targetId = button.getAttribute("data-tab-target");

    for (const otherButton of tabButtons) {
      otherButton.classList.toggle("tab-button-active", otherButton === button);
    }

    for (const pane of tabPanes) {
      pane.classList.toggle("tab-pane-active", pane.id === targetId);
    }
  });
}

async function fetchProjects() {
  const response = await fetch("/api/admin/projects", {
    credentials: "same-origin"
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }

  return Array.isArray(data.projects) ? data.projects : [];
}

function formatDateTime(value) {
  if (!value) {
    return "Updated time unavailable";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return `Updated ${date.toLocaleString()}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderProjects(projects) {
  const grid = document.getElementById("project-grid");
  if (!grid) {
    return;
  }

  if (!projects.length) {
    grid.innerHTML = `
      <article class="project-card">
        <strong>No workspaces yet</strong>
        <p>The bot has not created any owner-only project workspaces yet.</p>
      </article>
    `;
    return;
  }

  grid.innerHTML = projects.map((project) => `
    <article class="project-card">
      <p class="section-kicker">${escapeHtml(project.type || "workspace")}</p>
      <h3>${escapeHtml(project.name || project.slug)}</h3>
      <p>${escapeHtml(project.description || "Owner-only project workspace")}</p>
      <p class="note">${escapeHtml(formatDateTime(project.updatedAt))}</p>
      <div class="header-actions">
        <a class="button button-primary" href="${escapeHtml(project.routePath || "#")}">Open Project</a>
      </div>
    </article>
  `).join("");
}

async function bootstrapProjects() {
  const grid = document.getElementById("project-grid");
  try {
    renderProjects(await fetchProjects());
  } catch (error) {
    if (grid) {
      grid.innerHTML = `
        <article class="project-card">
          <strong>Unable to load projects</strong>
          <p>${escapeHtml(error.message)}</p>
        </article>
      `;
    }
  }
}

bootstrapProjects();
