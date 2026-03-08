# AI Change Log

## 2026-03-08

### Admin bot architecture established

- Added an owner-only admin bot workspace with persistent task queue, goals, notes, bot output history, console logging, and loop controls.
- Wired provider-backed AI execution for admin-only tasks using local AI docs as context.
- Split public site behavior from owner-only admin behavior with a dedicated admin view and owner-gated project routing.

### Durable brain and policy updates

- Established protected paths for secrets, storage, and public site files.
- Expanded writable roots for controlled backend work: `ai/`, `admin-projects/`, `server.js`, `package.json`, `package-lock.json`, `lib/`, `services/`, `routes/`, and `db/`.
- Documented that autonomous tasks should prefer repo updates over chat-style summaries.

### Project workspace model added

- Shifted app-building tasks toward isolated workspaces under `admin-projects/workspaces/<project-slug>/`.
- Added workspace scaffolding for new generated apps:
  - `README.md`
  - `.env.example`
  - `package.json`
  - `server.js`
  - `index.html`
  - `style.css`
  - `client.js`
  - `cbot-project.json`
- Added owner-only project discovery and a project hub page for generated workspaces.

### Command and process rails

- Added guarded command execution instead of arbitrary shell behavior.
- Added toggles for:
  - command execution
  - package install
  - app restart
  - project commands
  - project git actions
- Added project-scoped command handling for installs, launches, stop, and git operations.

### Windows testing adjustments

- Identified Windows detached workspace launches as unreliable (`spawn EINVAL` path).
- Changed local Windows behavior so generated project apps should be previewed through the main owner-only `/admin/projects/workspaces/<slug>/` route instead of relying on detached background launch.

### Failures learned from

- The bot previously completed some build tasks by only updating `ai/library.json`; that is not sufficient for project/build tasks.
- The bot previously overwrote root `server.js` and `package.json` in unstable ways; critical root-file validation was added to reject stripped-down replacements.
- Missing `xrpl` dependency and unstable workspace process handling caused crashes and failed fetches during XRPL-related project tasks.

### Current direction

- Use the main app as the stable owner-only shell.
- Let the bot build self-contained apps in project workspaces.
- Keep secrets in environment variables only.
- Prefer minimal additive root integrations and stable preview through the main app during local Windows testing.

### Additional local Windows rails added

- Bound `XRPL Trading Interface` to the persistent workspace `admin-projects/workspaces/personal-xrpl-bot` so reruns refine the same project instead of generating a new slug each time.
- Skipped project dependency installation in local Windows mode, including explicit AI-requested install commands.
- Skipped detached project `npm run start` / `npm run dev` launches in local Windows mode and returned preview guidance instead.
- Skipped project git follow-up in local Windows mode so project tasks finish as build/preview tasks instead of hanging in commit/push.
- Added stronger path sanitization to reduce malformed filenames and control-character paths.
- Cleaned malformed duplicate workspace clutter such as the bad duplicate `README` file in `personal-xrpl-bot`.

### VM dependency guardrails added

- Added known package-version normalization for bot-written workspace `package.json` files so `xrpl` is pinned to a published version (`^4.6.0`) instead of hallucinated future versions.
- Added install-time recovery for workspace dependency installs: if `npm install` fails with `ETARGET` for a known package such as `xrpl`, the bot repairs the workspace `package.json` to the approved version and retries once automatically.

### Current workspace checkpoint

- `XRPL Trading Interface` is now building into `admin-projects/workspaces/personal-xrpl-bot`.
- The local goal is to validate workspace quality and previewability through the main app before moving to the VM for real installs and persistent backend processes.
