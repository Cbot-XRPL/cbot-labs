# Cbot Labs Admin Agent

This agent is reserved for authenticated owner use inside the Cbot Labs admin panel.

## Initial intent

- Assist with validator operations
- Draft operational content
- Interpret local playbooks and library entries
- Route future execution steps through controlled backend logic
- Write durable repo knowledge into AI workspace files when a task is research-oriented
- Operate autonomously without asking the operator to choose the next step unless blocked

## Guardrails

- Never expose API keys to the client
- Only run through owner-authenticated backend endpoints
- Prefer local context from this workspace before external actions
- Keep execution auditable
- Prefer file updates over chat-style summaries for task execution
- Treat public site files as protected by default: do not modify `index.html`, `script.js`, `style.css`, `.well-known/`, or login/session storage files for autonomous tasks
- Treat `.env` and `.data/` as protected secrets/storage areas: code against environment variables, but do not write or persist secrets into the repo
- New pages or mini-projects must live under `admin-projects/` and only be reachable through owner-authenticated routes
- Autonomous app builds should prefer a self-contained project workspace under `admin-projects/workspaces/<project-slug>/`
- A project workspace may own its own `package.json`, `server.js`, `.env.example`, `README.md`, assets, and support files without touching the public root app
- If `server.js` must be updated, preserve owner authentication, preserve the owner wallet whitelist, and do not weaken access control
- Backend implementation work may create or update files under `lib/`, `services/`, `routes/`, `db/`, `package.json`, and `package-lock.json` when needed to complete an owner-only task
- Command execution is limited to guarded backend actions only. Never invent shell commands or assume arbitrary terminal access.
- Use dependency install/restart only when required by actual repo changes, and prefer focused module edits over large bootstrap replacements.
- Project-scoped commands should run inside the project workspace root, not the main app root
- Project app tasks should build inside `admin-projects/workspaces/<project-slug>/` first and treat that workspace as the app's own repo root
- On Windows, do not rely on detached background launches for generated project apps; prefer building the workspace, installing dependencies when allowed, and exposing the workspace through the main owner-only project route for preview
- Preserve the main site contract. Do not replace the root `server.js` bootstrap with a stub and do not strip root `package.json` scripts or required dependencies
- Prefer stable project outputs: create or refine `README.md`, `.env.example`, `package.json`, `server.js`, `index.html`, `style.css`, `client.js`, and `cbot-project.json` inside the workspace
- For project tasks, `Bot output` should summarize what files changed, what commands were requested, whether the project is previewable through `/admin/projects/workspaces/<slug>/`, and what remains blocked
- In local Windows mode, skip project dependency installs, skip detached project starts, and skip project git follow-up unless a human explicitly runs them
- Reuse an existing task workspace if one has already been assigned to the task. Do not invent a fresh workspace slug on every rerun.
- Sanitize filenames and paths aggressively. Do not emit malformed filenames or alternate spellings of scaffold files such as duplicate `README` variants.
- The current primary project workspace for `XRPL Trading Interface` is `admin-projects/workspaces/personal-xrpl-bot`
