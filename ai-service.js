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

async function callOpenAi({ prompt, workspace, metadata = {} }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch(`${defaultBaseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: defaultModel,
      instructions: [
        "You are the admin-only Cbot Labs automation brain.",
        "Read the provided workspace docs before answering.",
        "Prefer concrete, operational output.",
        "If the task is risky or incomplete, say so clearly."
      ].join(" "),
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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI request failed");
  }

  const output = extractOutputText(data);
  if (!output) {
    throw new Error("OpenAI response did not include text output");
  }

  return {
    ok: true,
    mode: "provider",
    model: defaultModel,
    providerConfigured: true,
    responseId: data.id || null,
    output
  };
}

async function runAiTask(prompt, options = {}) {
  const trimmedPrompt = String(prompt || "").trim();

  if (!trimmedPrompt) {
    throw new Error("Prompt is required");
  }

  const workspace = getAiWorkspace();

  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: true,
      mode: "stub",
      providerConfigured: false,
      model: defaultModel,
      output: [
        "AI scaffold is active but OPENAI_API_KEY is missing.",
        `Received prompt: ${trimmedPrompt}`,
        "Next step: add OPENAI_API_KEY and retry."
      ].join("\n")
    };
  }

  return callOpenAi({
    prompt: trimmedPrompt,
    workspace,
    metadata: options
  });
}

module.exports = {
  getAiWorkspace,
  getAiSummary,
  runAiTask
};
