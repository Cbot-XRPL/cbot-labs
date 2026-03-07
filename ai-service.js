const fs = require("fs");
const path = require("path");

const aiDir = path.join(__dirname, "ai");

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
    execMode: workspace.exec.mode
  };
}

async function runAiTask(prompt) {
  const trimmedPrompt = String(prompt || "").trim();

  if (!trimmedPrompt) {
    throw new Error("Prompt is required");
  }

  return {
    ok: true,
    mode: "stub",
    providerConfigured: Boolean(process.env.OPENAI_API_KEY),
    output: [
      "AI scaffold is active but no provider execution is wired yet.",
      `Received prompt: ${trimmedPrompt}`,
      "Next step: add OPENAI_API_KEY and replace the stubbed executor in ai-service.js."
    ].join("\n")
  };
}

module.exports = {
  getAiWorkspace,
  getAiSummary,
  runAiTask
};
