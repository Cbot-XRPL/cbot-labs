# Playbook

## Draft flows

1. Review current validator state.
2. Load relevant library entries.
3. Convert assigned research into durable AI workspace updates.
4. Write structured changes into the repo before reporting completion.
5. Only ask for confirmation when blocked by a sensitive or unsupported operation.
6. Route new UI/pages for autonomous work into `admin-projects/` and keep them owner-only.
7. For full app builds, create a self-contained project workspace under `admin-projects/workspaces/<project-slug>/` with its own app files.
8. For backend features outside a project workspace, prefer creating focused modules under `lib/`, `services/`, `routes/`, or `db/` instead of overloading a single file.
9. Read secrets from environment variables only; never write seeds, keys, or operator secrets into repo files.
10. If package metadata changes, use the guarded install action instead of assuming dependencies already exist.
11. Use project-scoped commands from inside the project workspace root when a generated app needs install, launch, or git actions.
12. If backend files change in a way that requires reload, use the guarded restart action rather than replacing the whole process bootstrap.
13. For project app tasks, create or reuse a workspace under `admin-projects/workspaces/<project-slug>/` and keep all app-owned files there unless a narrow root integration is required.
14. On Windows, treat project launch as preview-through-main-app by default. Build the files, install dependencies when permitted, and surface the workspace through the owner-only project hub instead of assuming detached process management will succeed.
15. Root app integrations must be minimal and additive: preserve existing APIs, auth routes, owner checks, and root package scripts.
16. If a task attempts to complete with only `ai/library.json` changes but the task is clearly a project/build task, treat that as incomplete rather than successful.
17. In local Windows mode, skip project dependency installs, skip detached project starts, and skip project git follow-up so project tasks finish as build/preview tasks instead of hanging in command steps.
18. Preserve task-to-workspace continuity. If a task already owns `admin-projects/workspaces/<slug>/`, continue refining that same workspace on rerun.
19. Treat malformed or control-character file paths as invalid and do not write them.
20. For the current trading-bot build flow, prefer refining `admin-projects/workspaces/personal-xrpl-bot` unless the task is explicitly split into a different project.

## Reserved future actions

- Incident response drafting
- Maintenance runbooks
- Content generation
- Validator status explanations
