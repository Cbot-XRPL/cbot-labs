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
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
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
  const normalizedPath = normalizeRepoPath(relativePath);
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
  return path.join(__dirname, normalizeRepoPath(relativePath));
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
      parsed = JSON.parse(String(content || ""));
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
      "Return an object with keys: action, summary, fileWrites, libraryEntries, notes, commands.",
      "Set action to workspace_update.",
      "fileWrites must be an array of objects with: path, content.",
      "Each path must be repo-relative and only target intended implementation files.",
      "Create new files when needed.",
      "Do not replace the whole existing server bootstrap or public app; prefer adding focused modules and small integrations.",
      "commands may only contain guarded values from this set: install_dependencies, restart_app.",
      "Use libraryEntries only if the task should also update ai/library.json.",
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

  if (mode === "library-update" || mode === "workspace-update") {
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

function applyAutonomousTaskResult(task, aiResult, policy = {}) {
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

  if (action !== "update_library" && action !== "workspace_update") {
    throw new Error(`Unsupported AI action: ${action}`);
  }

  const fileWrites = Array.isArray(parsed.fileWrites) ? parsed.fileWrites : [];
  const commands = Array.isArray(parsed.commands)
    ? parsed.commands.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  let nonLibraryFileWriteCount = 0;
  if (action === "workspace_update") {
    for (const fileWrite of fileWrites) {
      const relativePath = normalizeRepoPath(fileWrite?.path);
      const content = typeof fileWrite?.content === "string" ? fileWrite.content : "";
      if (!relativePath) {
        continue;
      }

      assertRepoWriteAllowed(relativePath, policy);
      assertCriticalFileIntegrity(relativePath, content);

      const absolutePath = getAbsoluteRepoPath(relativePath);
      const beforeText = fs.existsSync(absolutePath) ? readText(absolutePath) : null;
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

  if (action === "workspace_update" && nonLibraryFileWriteCount < 1) {
    throw new Error("Workspace task produced no non-library file changes");
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
  getAiWorkspace,
  getAiSummary,
  runAiTask
};
