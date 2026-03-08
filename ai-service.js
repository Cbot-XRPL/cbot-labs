const fs = require("fs");
const path = require("path");

const aiDir = path.join(__dirname, "ai");
const defaultModel = process.env.OPENAI_MODEL || "gpt-5-mini";
const defaultBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

const files = {
  manifest: path.join(aiDir, "manifest.json"),
  agent: path.join(aiDir, "agent.md"),
  library: path.join(aiDir, "library.json"),
  playbook: path.join(aiDir, "playbook.md"),
  exec: path.join(aiDir, "exec.json")
};

const defaultProjectWorkspaceBase = "admin-projects/workspaces";
const knownPackageVersionRules = {
  xrpl: "^4.6.0"
};

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, String(value));
}

function normalizeKnownDependencyVersions(pkg = {}) {
  const normalized = {
    ...pkg,
    dependencies: { ...(pkg.dependencies || {}) },
    devDependencies: { ...(pkg.devDependencies || {}) }
  };

  for (const [packageName, packageVersion] of Object.entries(knownPackageVersionRules)) {
    if (normalized.dependencies[packageName] && normalized.dependencies[packageName] !== packageVersion) {
      normalized.dependencies[packageName] = packageVersion;
    }
    if (normalized.devDependencies[packageName] && normalized.devDependencies[packageName] !== packageVersion) {
      normalized.devDependencies[packageName] = packageVersion;
    }
  }

  return normalized;
}

function normalizePackageJsonContent(relativePath, content) {
  if (normalizeRepoPath(relativePath) !== "package.json" && !normalizeRepoPath(relativePath).endsWith("/package.json")) {
    return String(content || "");
  }

  let parsed;
  try {
    parsed = JSON.parse(String(content || ""));
  } catch (_error) {
    return String(content || "");
  }

  return `${JSON.stringify(normalizeKnownDependencyVersions(parsed), null, 2)}\n`;
}

function getAiWorkspace() {
  const manifest = readJson(files.manifest);
  const library = readJson(files.library);
  const exec = readJson(files.exec);

  return {
    manifest,
    agent: readText(files.agent),
    library,
    playbook: readText(files.playbook),
    exec,
    files: Object.fromEntries(
      Object.entries(files).map(([key, filePath]) => [
        key,
        path.relative(__dirname, filePath).replaceAll("\\", "/")
      ])
    )
  };
}

function getAiSummary() {
  const workspace = getAiWorkspace();

  return {
    manifest: workspace.manifest,
    fileCount: Object.keys(workspace.files).length,
    files: workspace.files,
    configured: Boolean(process.env.OPENAI_API_KEY),
    execMode: workspace.exec.mode,
    model: process.env.OPENAI_MODEL || defaultModel
  };
}

function buildWorkspaceContext(workspace) {
  return [
    "Manifest JSON:",
    JSON.stringify(workspace.manifest, null, 2),
    "",
    "Agent Markdown:",
    workspace.agent,
    "",
    "Library JSON:",
    JSON.stringify(workspace.library, null, 2),
    "",
    "Playbook Markdown:",
    workspace.playbook,
    "",
    "Exec JSON:",
    JSON.stringify(workspace.exec, null, 2)
  ].join("\n");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeRepoPath(value) {
  return String(value || "")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/\.+(?=\/|$)/g, "")
    .replace(/^\.\/+/, "");
}

function sanitizePathSegments(value) {
  const normalized = normalizeRepoPath(value);
  if (!normalized) {
    return "";
  }

  const cleaned = normalized
    .split("/")
    .map((segment) => String(segment || "")
      .replace(/[<>:"|?*\u0000-\u001f]/g, "")
      .trim()
      .replace(/\s+/g, " "))
    .filter(Boolean)
    .join("/");

  return cleaned;
}

function pathMatchesRule(targetPath, rule) {
  const normalizedTarget = normalizeRepoPath(targetPath);
  const normalizedRule = normalizeRepoPath(rule);
  if (!normalizedRule) {
    return false;
  }

  if (normalizedRule.endsWith("/")) {
    return normalizedTarget.startsWith(normalizedRule);
  }

  return normalizedTarget === normalizedRule || normalizedTarget.startsWith(`${normalizedRule}/`);
}

function assertRepoWriteAllowed(relativePath, policy = {}) {
  const normalizedPath = sanitizePathSegments(relativePath);
  const writableRoots = Array.isArray(policy.writableRoots) ? policy.writableRoots : [];
  const protectedPaths = Array.isArray(policy.protectedPaths) ? policy.protectedPaths : [];

  if (normalizedPath.includes("..")) {
    throw new Error(`Blocked write outside repo policy: ${normalizedPath}`);
  }

  if (protectedPaths.some((rule) => pathMatchesRule(normalizedPath, rule))) {
    throw new Error(`Blocked by protected path policy: ${normalizedPath}`);
  }

  if (writableRoots.length && !writableRoots.some((rule) => pathMatchesRule(normalizedPath, rule))) {
    throw new Error(`Path is outside writable roots: ${normalizedPath}`);
  }
}

function getAbsoluteRepoPath(relativePath) {
  return path.join(__dirname, sanitizePathSegments(relativePath));
}

function getProjectWorkspaceContext(task, parsed = {}, context = {}) {
  const requestedSlug = String(
    parsed?.project?.slug
    || parsed?.projectSlug
    || task?.projectWorkspaceSlug
    || context?.projectWorkspaceSlug
    || task?.title
    || "project"
  ).trim();
  const slug = slugify(requestedSlug) || "project";
  const workspaceBase = normalizeRepoPath(context?.projectWorkspaceBase || defaultProjectWorkspaceBase);
  const workspaceRoot = `${workspaceBase}/${slug}`;
  const routePath = `/admin/projects/workspaces/${slug}/`;

  return {
    slug,
    workspaceBase,
    workspaceRoot,
    routePath,
    name: String(parsed?.project?.name || task?.title || slug).trim() || slug,
    description: String(parsed?.project?.description || task?.goal || "").trim()
  };
}

function scopeWorkspaceFilePath(relativePath, workspaceRoot) {
  const normalizedPath = sanitizePathSegments(relativePath);
  if (!normalizedPath) {
    return "";
  }

  if (
    normalizedPath.startsWith("admin-projects/")
    || normalizedPath.startsWith("ai/")
    || normalizedPath.startsWith("lib/")
    || normalizedPath.startsWith("routes/")
    || normalizedPath.startsWith("services/")
    || normalizedPath.startsWith("db/")
    || normalizedPath === "server.js"
    || normalizedPath === "package.json"
    || normalizedPath === "package-lock.json"
  ) {
    return normalizedPath;
  }

  return `${sanitizePathSegments(workspaceRoot)}/${normalizedPath}`;
}

function ensureProjectWorkspaceMetadata(projectContext) {
  const metadataPath = `${projectContext.workspaceRoot}/cbot-project.json`;
  const absolutePath = getAbsoluteRepoPath(metadataPath);
  let current = {};
  if (fs.existsSync(absolutePath)) {
    try {
      current = JSON.parse(readText(absolutePath));
    } catch (_error) {
      current = {};
    }
  }
  const next = {
    slug: projectContext.slug,
    name: projectContext.name,
    description: projectContext.description,
    routePath: projectContext.routePath,
    updatedAt: new Date().toISOString(),
    ...current
  };
  const beforeText = fs.existsSync(absolutePath) ? readText(absolutePath) : null;
  const afterText = `${JSON.stringify(next, null, 2)}\n`;

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  if (beforeText !== afterText) {
    writeJson(absolutePath, next);
    return {
      path: metadataPath,
      changed: true
    };
  }

  return {
    path: metadataPath,
    changed: false
  };
}

function buildProjectWorkspaceScaffold(projectContext) {
  const projectTitle = projectContext.name || projectContext.slug;
  const projectDescription = projectContext.description || "Owner-only bot-built project workspace.";

  return {
    "README.md": `# ${projectTitle}

${projectDescription}

## Purpose

This workspace is reserved for an owner-only admin project built by the Cbot Labs autonomous agent.

## Local commands

- \`npm install\`
- \`npm run dev\`
- \`npm start\`

## Notes

- Keep this workspace isolated from the public root app.
- Read runtime config from environment variables only.
- Do not place secrets in committed files.
`,
    ".env.example": `PORT=3100
NODE_ENV=development
`,
    "package.json": `${JSON.stringify({
      name: projectContext.slug,
      version: "0.1.0",
      private: true,
      main: "server.js",
      scripts: {
        start: "node server.js",
        dev: "node server.js"
      },
      dependencies: {
        express: "^4.21.2"
      }
    }, null, 2)}
`,
    "server.js": `const express = require("express");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 3100);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: ${JSON.stringify(projectTitle)},
    slug: ${JSON.stringify(projectContext.slug)},
    timestamp: new Date().toISOString()
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(\`${projectContext.slug} listening on http://localhost:\${port}\`);
});
`,
    "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${projectTitle}</title>
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <main class="shell">
    <section class="panel">
      <p class="eyebrow">Owner Project</p>
      <h1>${projectTitle}</h1>
      <p class="summary">${projectDescription}</p>
      <div id="app" class="app-card">Workspace scaffold ready.</div>
    </section>
  </main>
  <script src="./client.js"></script>
</body>
</html>
`,
    "style.css": `:root {
  --bg: #08111d;
  --panel: #122033;
  --border: rgba(121, 247, 200, 0.18);
  --text: #eef6ff;
  --muted: #9cb3c9;
  --accent: #79f7c8;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  font-family: "Space Grotesk", system-ui, sans-serif;
  color: var(--text);
  background: linear-gradient(180deg, #07111f 0%, #09192d 100%);
}

.shell {
  width: min(980px, calc(100% - 32px));
  margin: 0 auto;
  padding: 32px 0 48px;
}

.panel {
  padding: 28px;
  border-radius: 24px;
  background: var(--panel);
  border: 1px solid var(--border);
}

.eyebrow {
  margin: 0 0 10px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--accent);
  font-size: 0.76rem;
}

.summary {
  color: var(--muted);
  line-height: 1.7;
}

.app-card {
  margin-top: 20px;
  padding: 20px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
`,
    "client.js": `async function bootstrap() {
  const mount = document.getElementById("app");
  if (!mount) {
    return;
  }

  try {
    const response = await fetch("./api/health");
    const data = await response.json();
    mount.textContent = data.ok
      ? \`Workspace online at \${data.timestamp}\`
      : "Workspace health check failed.";
  } catch (error) {
    mount.textContent = \`Workspace ready. Health check unavailable: \${error.message}\`;
  }
}

bootstrap();
`
  };
}

function ensureProjectWorkspaceScaffold(projectContext) {
  const scaffold = buildProjectWorkspaceScaffold(projectContext);
  const changedFiles = [];

  for (const [relativeFile, content] of Object.entries(scaffold)) {
    const relativePath = `${projectContext.workspaceRoot}/${relativeFile}`;
    const absolutePath = getAbsoluteRepoPath(relativePath);
    if (fs.existsSync(absolutePath)) {
      continue;
    }

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeText(absolutePath, content);
    changedFiles.push(relativePath);
  }

  return changedFiles;
}

function assertCriticalFileIntegrity(relativePath, content) {
  const normalizedPath = normalizeRepoPath(relativePath);

  if (normalizedPath === "server.js") {
    const requiredMarkers = [
      "/api/status",
      "/api/app",
      "/api/auth/session",
      "/api/admin/bot",
      "/api/toml/xahau"
    ];

    for (const marker of requiredMarkers) {
      if (!String(content || "").includes(marker)) {
        throw new Error(`Rejected server.js write missing required app route marker: ${marker}`);
      }
    }
  }

  if (normalizedPath === "package.json") {
    let parsed;
    try {
      parsed = normalizeKnownDependencyVersions(JSON.parse(String(content || "")));
    } catch (_error) {
      throw new Error("Rejected package.json write because it is not valid JSON");
    }

    const startScript = parsed?.scripts?.start;
    const devScript = parsed?.scripts?.dev;
    if (!startScript || !devScript) {
      throw new Error("Rejected package.json write missing required start/dev scripts");
    }

    const dependencies = parsed?.dependencies || {};
    const devDependencies = parsed?.devDependencies || {};
    const requiredDependencies = ["express", "dotenv", "xumm"];

    for (const dependencyName of requiredDependencies) {
      if (!dependencies[dependencyName]) {
        throw new Error(`Rejected package.json write missing required dependency: ${dependencyName}`);
      }
    }

    if (!devDependencies.nodemon) {
      throw new Error("Rejected package.json write missing required devDependency: nodemon");
    }
  }

  const personalBotClientPaths = [
    "admin-projects/workspaces/personal-xrpl-bot/client.js",
    "admin-projects/workspaces/personal-xrpl-bot/public/client.js"
  ];
  if (personalBotClientPaths.includes(normalizedPath)) {
    const requiredMarkers = [
      "/api/admin/personal-bot/status",
      "/api/admin/personal-bot/metrics",
      "/api/admin/personal-bot/poll"
    ];

    for (const marker of requiredMarkers) {
      if (!String(content || "").includes(marker)) {
        throw new Error(`Rejected personal-xrpl-bot client write missing required API contract marker: ${marker}`);
      }
    }

    if (String(content || "").includes("/admin-projects/workspaces/personal-xrpl-bot/api/admin/personal-bot/")) {
      throw new Error("Rejected personal-xrpl-bot client write using nested workspace API paths");
    }
  }
}

function extractOutputText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
      if (content.type === "text" && content.text) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    throw new Error("OpenAI response was empty");
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch) {
      return JSON.parse(fencedMatch[1].trim());
    }

    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
  }

  throw new Error("OpenAI response did not contain valid JSON");
}

function normalizeLibraryEntry(entry) {
  const title = String(entry?.title || "").trim();
  if (!title) {
    return null;
  }

  const id = String(entry?.id || "").trim() || slugify(title);
  const summary = String(entry?.summary || "").trim();
  const tags = Array.isArray(entry?.tags)
    ? entry.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];
  const details = Array.isArray(entry?.details)
    ? entry.details.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const links = Array.isArray(entry?.links)
    ? entry.links
      .map((link) => ({
        label: String(link?.label || link?.url || "").trim(),
        url: String(link?.url || "").trim()
      }))
      .filter((link) => link.label && link.url)
    : [];

  return {
    id,
    title,
    summary,
    tags,
    details,
    links,
    updatedAt: new Date().toISOString()
  };
}

function mergeLibraryEntries(currentLibrary, incomingEntries) {
  const existingEntries = Array.isArray(currentLibrary?.entries) ? currentLibrary.entries : [];
  const nextEntries = [];
  const seen = new Map();

  for (const entry of existingEntries) {
    const normalized = normalizeLibraryEntry(entry);
    if (!normalized) {
      continue;
    }

    const key = normalized.id || slugify(normalized.title);
    seen.set(key, normalized);
    nextEntries.push(normalized);
  }

  for (const entry of incomingEntries) {
    const normalized = normalizeLibraryEntry(entry);
    if (!normalized) {
      continue;
    }

    const key = normalized.id || slugify(normalized.title);
    if (seen.has(key)) {
      const previous = seen.get(key);
      const merged = {
        ...previous,
        ...normalized,
        tags: Array.from(new Set([...(previous.tags || []), ...(normalized.tags || [])])),
        details: Array.from(new Set([...(previous.details || []), ...(normalized.details || [])])),
        links: Array.from(new Map(
          [...(previous.links || []), ...(normalized.links || [])]
            .map((link) => [`${link.label}|${link.url}`, link])
        ).values()),
        updatedAt: normalized.updatedAt
      };
      seen.set(key, merged);
      const index = nextEntries.findIndex((item) => item.id === key);
      nextEntries[index] = merged;
      continue;
    }

    seen.set(key, normalized);
    nextEntries.push(normalized);
  }

  return {
    ...currentLibrary,
    entries: nextEntries
  };
}

function buildAutonomousTaskInstructions(mode) {
  const base = [
    "You are the admin-only Cbot Labs autonomous agent.",
    "Do not ask the user follow-up questions.",
    "Do not offer multiple choice next steps.",
    "Act autonomously using consensus from the workspace docs and the assigned task.",
    "Return JSON only."
  ];

  if (mode === "library-update") {
    base.push(
      "Your job is to turn the assigned task into durable repo knowledge.",
      "Write research output as structured library entries, not as a chat answer.",
      "Return an object with keys: action, summary, libraryEntries, notes.",
      "Set action to update_library.",
      "libraryEntries must be an array of objects with: id, title, summary, tags, details, links.",
      "details must be concise operational bullets as strings.",
      "links must be objects with label and url.",
      "notes must be a short array of execution notes.",
      "Do not include commentary outside the JSON object."
    );
  }

  if (mode === "workspace-update") {
    base.push(
      "Your job is to make durable repo changes, not just describe them.",
      "For app or page tasks, build a self-contained project workspace under the provided admin-projects workspace root.",
      "The workspace should own its own app files like index.html, server.js, package.json, .env.example, README, and supporting assets.",
      "Assume a starter scaffold may already exist in the workspace and refine it instead of replacing everything blindly.",
      "Return an object with keys: action, summary, project, fileWrites, libraryEntries, notes, commands.",
      "Set action to workspace_update.",
      "project must be an object with: slug, name, description.",
      "fileWrites must be an array of objects with: path, content.",
      "Paths may be repo-relative or project-relative. Project-relative paths will be scoped into the provided project workspace root.",
      "Create new files when needed.",
      "Do not replace the whole existing root server bootstrap or public app; project apps should live in their own workspace.",
      "commands may only contain guarded values from this set: install_dependencies, restart_app, npm_run_dev, npm_run_start, stop_project_process, git_init, git_set_remote, git_add_commit, git_push.",
      "commands should be objects with keys: name, cwd, and optional message.",
      "Use cwd relative to the project workspace root unless an explicit repo-relative admin-projects workspace path is required.",
      "Use libraryEntries only if the task should also update ai/library.json.",
      "Do not include markdown fences or commentary outside the JSON object."
    );
  }

  if (mode === "repo-update") {
    base.push(
      "Your job is to make narrow durable repo changes without creating a project workspace.",
      "Return an object with keys: action, summary, fileWrites, notes.",
      "Set action to repo_update.",
      "fileWrites must be an array of objects with: path and content.",
      "Every fileWrites path must be repo-relative and must respect the task constraints in metadata.",
      "Do not create a workspace scaffold.",
      "Do not create files outside the explicitly allowed or requested repo paths.",
      "Do not emit commands.",
      "Do not include markdown fences or commentary outside the JSON object."
    );
  }

  return base.join(" ");
}

async function callOpenAi({ prompt, workspace, metadata = {}, mode = "text", timeoutMs = 0 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  let response;
  try {
    response = await fetch(`${defaultBaseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller?.signal,
      body: JSON.stringify({
        model: defaultModel,
        instructions: buildAutonomousTaskInstructions(mode),
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  "Workspace docs:",
                  buildWorkspaceContext(workspace),
                  "",
                  "Task request:",
                  prompt,
                  "",
                  "Metadata:",
                  JSON.stringify(metadata, null, 2)
                ].join("\n")
              }
            ]
          }
        ]
      })
    });
  } catch (error) {
    if (timeout) {
      clearTimeout(timeout);
    }

    if (error?.name === "AbortError") {
      throw new Error(`OpenAI request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }

    throw error;
  }

  if (timeout) {
    clearTimeout(timeout);
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI request failed");
  }

  const output = extractOutputText(data);
  if (!output) {
    throw new Error("OpenAI response did not include text output");
  }

  const result = {
    ok: true,
    mode: "provider",
    model: defaultModel,
    providerConfigured: true,
    responseId: data.id || null,
    output
  };

  if (mode === "library-update" || mode === "workspace-update" || mode === "repo-update") {
    result.parsed = extractJsonObject(output);
  }

  return result;
}

async function runAiTask(prompt, options = {}) {
  const trimmedPrompt = String(prompt || "").trim();

  if (!trimmedPrompt) {
    throw new Error("Prompt is required");
  }

  const workspace = getAiWorkspace();
  const mode = options.mode || "text";

  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: true,
      mode: "stub",
      providerConfigured: false,
      model: defaultModel,
      output: [
        "AI scaffold is active but OPENAI_API_KEY is missing.",
        `Received prompt: ${trimmedPrompt}`,
        "Task execution could not continue."
      ].join("\n")
    };
  }

  return callOpenAi({
    prompt: trimmedPrompt,
    workspace,
    metadata: options,
    mode,
    timeoutMs: options.timeoutMs
  });
}

function applyAutonomousTaskResult(task, aiResult, policy = {}, context = {}) {
  const parsed = aiResult?.parsed;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI task did not return a structured result");
  }

  const action = parsed.action || "unknown";
  const summary = String(parsed.summary || "").trim() || `Updated library for task ${task.title}`;
  const notes = Array.isArray(parsed.notes)
    ? parsed.notes.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const changedFiles = [];
  const outputLines = [summary];

  if (action !== "update_library" && action !== "workspace_update" && action !== "repo_update") {
    throw new Error(`Unsupported AI action: ${action}`);
  }

  const fileWrites = Array.isArray(parsed.fileWrites) ? parsed.fileWrites : [];
  const projectContext = action === "workspace_update"
    ? getProjectWorkspaceContext(task, parsed, context)
    : null;
  const commands = Array.isArray(parsed.commands)
    ? parsed.commands
      .map((command) => {
        if (typeof command === "string") {
          if (command === "restart_app") {
            return {
              name: String(command || "").trim()
            };
          }

          if (command === "install_dependencies") {
            return projectContext
              ? {
                name: "install_dependencies",
                cwd: projectContext.workspaceRoot
              }
              : {
                name: "install_dependencies"
              };
          }

          return {
            name: String(command || "").trim(),
            cwd: projectContext?.workspaceRoot || ""
          };
        }

        if (String(command?.name || "").trim() === "restart_app") {
          return {
            name: "restart_app"
          };
        }

        return {
          name: String(command?.name || "").trim(),
          cwd: command?.cwd
            ? scopeWorkspaceFilePath(command.cwd, projectContext?.workspaceRoot || "")
            : (projectContext?.workspaceRoot || ""),
          message: String(command?.message || "").trim()
        };
      })
      .filter((command) => command.name)
    : [];
  const taskConstraints = context?.taskConstraints || {};
  const workspaceBase = normalizeRepoPath(context?.projectWorkspaceBase || defaultProjectWorkspaceBase);
  const allowedExactPaths = Array.isArray(taskConstraints.explicitRepoPaths)
    ? taskConstraints.explicitRepoPaths.map((item) => normalizeRepoPath(item)).filter(Boolean)
    : [];

  if (action === "repo_update" && commands.length) {
    throw new Error("Repo update task returned commands, which are not allowed for constrained repo updates");
  }

  if (taskConstraints.forbidsCommands && commands.length) {
    throw new Error("Task explicitly forbids commands but the AI requested commands");
  }

  const enforceTaskPathConstraints = (relativePath, existedBeforeWrite) => {
    const normalizedPath = normalizeRepoPath(relativePath);

    if (taskConstraints.forbidsWorkspaceCreation && normalizedPath.startsWith(`${workspaceBase}/`)) {
      throw new Error(`Task explicitly forbids workspace creation: ${normalizedPath}`);
    }

    if (allowedExactPaths.length && !allowedExactPaths.includes(normalizedPath)) {
      throw new Error(`Task is constrained to explicit repo paths, but AI wrote: ${normalizedPath}`);
    }

    if (taskConstraints.forbidsNewFiles && !existedBeforeWrite) {
      throw new Error(`Task explicitly forbids creating new files: ${normalizedPath}`);
    }
  };

  let nonLibraryFileWriteCount = 0;
  if (action === "workspace_update") {
    const scaffoldChanges = ensureProjectWorkspaceScaffold(projectContext);
    for (const scaffoldFile of scaffoldChanges) {
      if (!changedFiles.includes(scaffoldFile)) {
        changedFiles.push(scaffoldFile);
        nonLibraryFileWriteCount += 1;
      }
    }

    for (const fileWrite of fileWrites) {
      const relativePath = scopeWorkspaceFilePath(fileWrite?.path, projectContext.workspaceRoot);
      const content = normalizePackageJsonContent(
        relativePath,
        typeof fileWrite?.content === "string" ? fileWrite.content : ""
      );
      if (!relativePath) {
        continue;
      }

      assertRepoWriteAllowed(relativePath, policy);
      assertCriticalFileIntegrity(relativePath, content);

      const absolutePath = getAbsoluteRepoPath(relativePath);
      const beforeText = fs.existsSync(absolutePath) ? readText(absolutePath) : null;
      enforceTaskPathConstraints(relativePath, beforeText !== null);
      if (beforeText === content) {
        continue;
      }

      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeText(absolutePath, content);
      changedFiles.push(relativePath);
      if (relativePath !== "ai/library.json") {
        nonLibraryFileWriteCount += 1;
      }
    }

    const metadataResult = ensureProjectWorkspaceMetadata(projectContext);
    if (metadataResult.changed && !changedFiles.includes(metadataResult.path)) {
      changedFiles.push(metadataResult.path);
      nonLibraryFileWriteCount += 1;
    }
  }

  if (action === "repo_update") {
    for (const fileWrite of fileWrites) {
      const relativePath = sanitizePathSegments(fileWrite?.path);
      const content = normalizePackageJsonContent(
        relativePath,
        typeof fileWrite?.content === "string" ? fileWrite.content : ""
      );
      if (!relativePath) {
        continue;
      }

      assertRepoWriteAllowed(relativePath, policy);
      assertCriticalFileIntegrity(relativePath, content);

      const absolutePath = getAbsoluteRepoPath(relativePath);
      const beforeText = fs.existsSync(absolutePath) ? readText(absolutePath) : null;
      enforceTaskPathConstraints(relativePath, beforeText !== null);
      if (beforeText === content) {
        continue;
      }

      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeText(absolutePath, content);
      changedFiles.push(relativePath);
      if (relativePath !== "ai/library.json") {
        nonLibraryFileWriteCount += 1;
      }
    }
  }

  const libraryEntries = Array.isArray(parsed.libraryEntries) ? parsed.libraryEntries : [];
  const entryTitles = libraryEntries
    .map((entry) => String(entry?.title || "").trim())
    .filter(Boolean);
  if (libraryEntries.length) {
    const nextLibrary = mergeLibraryEntries(readJson(files.library), libraryEntries);
    const beforeText = readText(files.library);
    const afterText = `${JSON.stringify(nextLibrary, null, 2)}\n`;
    const libraryPath = path.relative(__dirname, files.library).replaceAll("\\", "/");

    assertRepoWriteAllowed(libraryPath, policy);

    if (beforeText !== afterText) {
      writeJson(files.library, nextLibrary);
      changedFiles.push(libraryPath);
    }
  }

  if ((action === "workspace_update" || action === "repo_update") && nonLibraryFileWriteCount < 1) {
    throw new Error("Task produced no non-library file changes");
  }

  if (!changedFiles.length) {
    throw new Error(action === "workspace_update"
      ? "AI task produced no repo file changes"
      : "AI task produced no new library changes");
  }

  if (libraryEntries.length) {
    outputLines.push(`Library entries added or updated: ${libraryEntries.length}`);
    if (entryTitles.length) {
      outputLines.push("Entry titles:", ...entryTitles.map((title) => `- ${title}`));
    }
  }

  return {
    summary,
    notes,
    changedFiles,
    project: projectContext,
    libraryEntryCount: libraryEntries.length,
    entryTitles,
    commands,
    output: [
      ...outputLines,
      `Changed files: ${changedFiles.join(", ")}`,
      ...(notes.length ? ["Notes:", ...notes.map((note) => `- ${note}`)] : [])
    ].join("\n")
  };
}

module.exports = {
  applyAutonomousTaskResult,
  defaultProjectWorkspaceBase,
  getAiWorkspace,
  getAiSummary,
  knownPackageVersionRules,
  runAiTask
};
