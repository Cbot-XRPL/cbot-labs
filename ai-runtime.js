const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { applyAutonomousTaskResult, getAiWorkspace, runAiTask } = require("./ai-service");

const execFileAsync = promisify(execFile);

const dataDir = path.join(__dirname, ".data");
const botDbFile = path.join(dataDir, "bot-db.json");
const execFilePath = path.join(__dirname, "ai", "exec.json");
const notesLimit = 80;
const activityLimit = 250;
const botOutputLimit = 120;
const consoleLimit = 400;
const taskHeartbeatMs = 15000;

let timer = null;

function defaultDb() {
  return {
    config: {
      enabled: false,
      autoCallLlm: false,
      autoCommit: false,
      autoPush: false,
      pauseWhenQueueEmpty: true,
      idleDelaySeconds: 45,
      postTaskDelaySeconds: 15,
      retryDelaySeconds: 90,
      maxTaskRuntimeMinutes: 20,
      maxRetries: 2,
      writableRoots: ["ai/"],
      protectedPaths: [
        ".env",
        ".data/",
        "server.js"
      ]
    },
    goals: [],
    tasks: [],
    notes: [],
    activity: [],
    state: {
      isRunning: false,
      stopRequested: false,
      activeRunId: null,
      currentTaskId: null,
      lastRunAt: null,
      nextRunAt: null,
      lastResult: null,
      lastError: null,
      botOutput: null,
      botOutputEntries: [],
      consoleEntries: [],
      runCount: 0
    }
  };
}

function ensureStorage() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(botDbFile)) {
    fs.writeFileSync(botDbFile, JSON.stringify(defaultDb(), null, 2));
  }
}

function loadDb() {
  ensureStorage();

  try {
    const raw = fs.readFileSync(botDbFile, "utf8");
    const parsed = JSON.parse(raw);
    const next = {
      ...defaultDb(),
      ...parsed,
      config: {
        ...defaultDb().config,
        ...(parsed.config || {})
      },
      state: {
        ...defaultDb().state,
        ...(parsed.state || {})
      },
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      tasks: normalizeTaskOrder(Array.isArray(parsed.tasks) ? parsed.tasks : []),
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      activity: Array.isArray(parsed.activity) ? parsed.activity : []
    };

    next.state.botOutputEntries = normalizeBotOutputEntries(next.state, next.notes, next.tasks);
    next.state.botOutput = next.state.botOutputEntries[0]?.text || next.state.botOutput || null;
    return next;
  } catch (error) {
    return defaultDb();
  }
}

function saveDb(db) {
  ensureStorage();
  fs.writeFileSync(botDbFile, JSON.stringify(db, null, 2));
}

function normalizeBotOutputEntries(state = {}, notes = [], tasks = []) {
  const entries = [];
  const seen = new Set();

  const normalizeEntryTextForKey = (value) => {
    const lines = String(value || "").trim().split("\n");
    if (lines.length > 1) {
      const secondLine = lines[1].trim();
      const parsed = new Date(secondLine);
      if (!Number.isNaN(parsed.getTime())) {
        lines.splice(1, 1);
        while (lines[1] === "") {
          lines.splice(1, 1);
        }
      }
    }

    return lines.join("\n").trim();
  };

  const pushEntry = (entry) => {
    if (!entry || typeof entry.text !== "string") {
      return;
    }

    const text = entry.text.trim();
    if (!text) {
      return;
    }

    const createdAt = entry.createdAt || new Date().toISOString();
    const source = entry.source || "system";
    const key = `${createdAt}|${source}|${normalizeEntryTextForKey(text)}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    entries.push({
      id: entry.id || crypto.randomUUID(),
      source,
      createdAt,
      text
    });
  };

  if (Array.isArray(state.botOutputEntries)) {
    for (const entry of state.botOutputEntries) {
      pushEntry(entry);
    }
  }

  if (!entries.length && state.botOutput) {
    pushEntry({
      source: "legacy-output",
      createdAt: state.lastRunAt || new Date().toISOString(),
      text: state.botOutput
    });
  }

  for (const task of tasks) {
    if (task.status !== "completed" || !task.lastOutput) {
      continue;
    }

    pushEntry({
      source: "completed-task",
      createdAt: task.completedAt || task.startedAt || task.createdAt,
      text: buildRunSummary(
        task,
        task.lastOutput,
        task.git,
        task.completedAt || task.startedAt || task.createdAt
      )
    });
  }

  if (!Array.isArray(state.botOutputEntries) || !state.botOutputEntries.length) {
    for (const note of notes) {
      const noteTitle = String(note.title || "");
      if (noteTitle.startsWith("Run result for ") || noteTitle.startsWith("Run error for ")) {
        continue;
      }

      pushEntry({
        source: "note",
        createdAt: note.createdAt,
        text: [
          `Recovered note: ${note.title}`,
          new Date(note.createdAt).toLocaleString(),
          "",
          note.body
        ].join("\n")
      });
    }
  }

  return entries
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, botOutputLimit);
}

function normalizeTaskOrder(tasks) {
  return [...tasks]
    .sort((a, b) => {
      const orderA = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;

      if (orderA !== orderB) {
        return orderA - orderB;
      }

      return new Date(a.createdAt) - new Date(b.createdAt);
    })
    .map((task, index) => ({
      ...task,
      locked: Boolean(task.locked),
      allowRerun: Boolean(task.allowRerun),
      order: index + 1
    }));
}

function updateDb(mutator) {
  const db = loadDb();
  const result = mutator(db) || db;
  saveDb(result);
  return result;
}

function addActivity(type, message, meta = {}) {
  updateDb((db) => {
    db.activity.unshift({
      id: crypto.randomUUID(),
      type,
      message,
      meta,
      createdAt: new Date().toISOString()
    });
    db.activity = db.activity.slice(0, activityLimit);
    return db;
  });
}

function addConsoleLine(message, meta = {}) {
  updateDb((db) => {
    db.state.consoleEntries.unshift({
      id: crypto.randomUUID(),
      message,
      meta,
      createdAt: new Date().toISOString()
    });
    db.state.consoleEntries = db.state.consoleEntries.slice(0, consoleLimit);
    return db;
  });
}

function addNote(title, body, relatedTaskId = null) {
  updateDb((db) => {
    db.notes.unshift({
      id: crypto.randomUUID(),
      title,
      body,
      relatedTaskId,
      createdAt: new Date().toISOString()
    });
    db.notes = db.notes.slice(0, notesLimit);
    return db;
  });
}

function updateExecFile(patch) {
  try {
    const current = JSON.parse(fs.readFileSync(execFilePath, "utf8"));
    const next = {
      ...current,
      ...patch
    };
    fs.writeFileSync(execFilePath, JSON.stringify(next, null, 2));
  } catch (error) {
    addActivity("error", "Failed to update exec file", {
      error: error.message
    });
  }
}

function appendBotOutput(text, source = "system", createdAt = new Date().toISOString()) {
  updateDb((db) => {
    const nextEntry = {
      id: crypto.randomUUID(),
      source,
      createdAt,
      text: String(text || "").trim()
    };

    if (!nextEntry.text) {
      return db;
    }

    db.state.botOutputEntries = normalizeBotOutputEntries({
      ...db.state,
      botOutputEntries: [nextEntry, ...(db.state.botOutputEntries || [])]
    }, db.notes, db.tasks);
    db.state.botOutput = db.state.botOutputEntries[0]?.text || null;
    return db;
  });
}

function buildRunSummary(task, resultText, gitResult, createdAt = new Date().toISOString()) {
  return [
    `Run result for ${task.title}`,
    new Date(createdAt).toLocaleString(),
    "",
    `Task: ${task.title}`,
    `Goal: ${task.goal || "n/a"}`,
    `Assigned block: ${task.assignedTaskBlock || "n/a"}`,
    `Result: ${resultText}`,
    `Git: ${(gitResult?.actions || []).join("; ") || "no git actions"}`
  ].join("\n");
}

function buildTaskSignature(payload) {
  return [
    String(payload?.title || "").trim().toLowerCase(),
    String(payload?.goal || "").trim().toLowerCase(),
    String(payload?.assignedTaskBlock || "").trim().toLowerCase()
  ].join("::");
}

function inferTaskExecutionMode(task) {
  const combined = [
    task?.title,
    task?.goal,
    task?.assignedTaskBlock
  ].join(" ").toLowerCase();

  if (
    combined.includes("library")
    || combined.includes("research")
    || combined.includes("resource")
    || combined.includes("examples")
    || combined.includes("study how")
  ) {
    return "library-update";
  }

  return "library-update";
}

function findCompletedTaskMatch(tasks, payload, excludeTaskId = null) {
  const signature = buildTaskSignature(payload);
  if (!signature.replaceAll(":", "")) {
    return null;
  }

  return tasks.find((task) => (
    task.id !== excludeTaskId
    && task.status === "completed"
    && buildTaskSignature(task) === signature
  )) || null;
}

function startTaskHeartbeat(task) {
  return setInterval(() => {
    addActivity("task", "Task still working", {
      taskId: task.id,
      title: task.title,
      status: "running"
    });
    addConsoleLine("heartbeat: task still working", {
      taskId: task.id,
      title: task.title
    });
  }, taskHeartbeatMs);
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} exceeded ${Math.round(timeoutMs / 60000)} minute limit`));
      }, timeoutMs);
    })
  ]);
}

function scheduleNextRun(seconds) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  const db = updateDb((current) => {
    current.state.nextRunAt = new Date(Date.now() + (seconds * 1000)).toISOString();
    return current;
  });

  if (!db.config.enabled) {
    return;
  }

  timer = setTimeout(() => {
    runLoopCycle().catch((error) => {
      addActivity("error", "Bot loop crashed", {
        error: error.message
      });
    });
  }, seconds * 1000);
}

function clearScheduledRun() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  updateDb((current) => {
    current.state.nextRunAt = null;
    return current;
  });
}

async function git(args) {
  return execFileAsync("git", args, {
    cwd: __dirname
  });
}

async function getGitSnapshot() {
  try {
    const [{ stdout: branchRaw }, { stdout: statusRaw }] = await Promise.all([
      git(["rev-parse", "--abbrev-ref", "HEAD"]),
      git(["status", "--short"])
    ]);

    return {
      available: true,
      branch: branchRaw.trim(),
      dirty: Boolean(statusRaw.trim()),
      status: statusRaw.trim() || "clean"
    };
  } catch (error) {
    return {
      available: false,
      error: error.message
    };
  }
}

async function maybeRunGitActions(task, config) {
  const gitSnapshot = await getGitSnapshot();

  if (!gitSnapshot.available) {
    return {
      snapshot: gitSnapshot,
      actions: ["git unavailable"]
    };
  }

  const actions = [];

  if (config.autoCommit && gitSnapshot.dirty) {
    const commitMessage = `bot: ${task.title}`;

    try {
      await git(["add", "-A"]);
      await git(["commit", "-m", commitMessage]);
      actions.push(`committed: ${commitMessage}`);
      addActivity("git", "Created bot commit", {
        taskId: task.id,
        commitMessage
      });
    } catch (error) {
      actions.push(`commit failed: ${error.message}`);
      addActivity("error", "Bot git commit failed", {
        taskId: task.id,
        error: error.message
      });
    }
  }

  if (config.autoPush) {
    try {
      await git(["push"]);
      actions.push("push succeeded");
      addActivity("git", "Pushed bot changes to remote", {
        taskId: task.id
      });
    } catch (error) {
      actions.push(`push failed: ${error.message}`);
      addActivity("error", "Bot git push failed", {
        taskId: task.id,
        error: error.message
      });
    }
  }

  return {
    snapshot: await getGitSnapshot(),
    actions
  };
}

function getPendingTask(db) {
  return normalizeTaskOrder(db.tasks)
    .filter((task) => {
      if (task.locked) {
        return false;
      }

      if (task.status === "pending") {
        return true;
      }

      return task.status === "waiting" && db.config.autoCallLlm;
    })[0] || null;
}

function hasRunnableTask(db) {
  return Boolean(getPendingTask(db));
}

function maybeWakeLoop(reason) {
  const db = loadDb();
  if (!db.config.enabled || db.state.isRunning || !hasRunnableTask(db)) {
    return;
  }

  addActivity("loop", reason);
  scheduleNextRun(1);
}

function buildLoopPrompt(task, db, workspace) {
  const goalsText = db.goals.map((goal) => `- ${goal.text}`).join("\n") || "- No active goals";
  const taskBlock = task.assignedTaskBlock || "No assigned task block provided.";
  const writableRoots = (db.config.writableRoots || []).map((item) => `- ${item}`).join("\n") || "- none";
  const protectedPaths = (db.config.protectedPaths || []).map((item) => `- ${item}`).join("\n") || "- none";

  return [
    "You are the admin-only Cbot Labs automation agent.",
    "Read the AI docs and execute the assigned task block.",
    "Do not ask the operator what to do next.",
    "Prefer durable repo updates over chat-style summaries.",
    `Task title: ${task.title}`,
    `Task goal: ${task.goal || "No explicit goal provided"}`,
    "Assigned task block:",
    taskBlock,
    "Active goals:",
    goalsText,
    "Writable roots:",
    writableRoots,
    "Protected paths:",
    protectedPaths,
    `Manifest: ${workspace.manifest.name} v${workspace.manifest.version}`,
    `Primary knowledge file: ${workspace.files.library}`
  ].join("\n");
}

async function runLoopCycle() {
  const initialDb = loadDb();
  const runId = crypto.randomUUID();

  if (initialDb.state.isRunning) {
    addActivity("loop", "Skipped cycle because a run is already active");
    return getSnapshot();
  }

  updateDb((db) => {
    db.state.isRunning = true;
    db.state.stopRequested = false;
    db.state.activeRunId = runId;
    db.state.lastError = null;
    db.state.lastRunAt = new Date().toISOString();
    db.state.runCount += 1;
    return db;
  });

  addActivity("loop", "Bot cycle started");
  addConsoleLine("cycle started");

  let db = loadDb();
  const task = getPendingTask(db);
  const workspace = getAiWorkspace();
  let heartbeatTimer = null;

  if (!task) {
    addActivity("loop", "Queue check complete: no runnable task found");
    addConsoleLine("queue check complete: no runnable task found");
    updateExecFile({
      lastUpdated: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastTaskId: null,
      lastTaskStatus: "idle"
    });

    updateDb((current) => {
      current.state.isRunning = false;
      current.state.activeRunId = null;
      current.state.currentTaskId = null;
      current.state.lastResult = initialDb.config.pauseWhenQueueEmpty
        ? "Queue empty, loop paused"
        : "Idle";
      current.state.stopRequested = false;
      return current;
    });

    appendBotOutput(initialDb.config.pauseWhenQueueEmpty ? "Queue empty, loop paused" : "Idle", "loop");

    const latest = loadDb();
    if (latest.config.enabled && latest.config.pauseWhenQueueEmpty) {
      clearScheduledRun();
    } else {
      scheduleNextRun(latest.config.idleDelaySeconds);
    }
    return getSnapshot();
  }

  db = updateDb((current) => {
    const currentTask = current.tasks.find((entry) => entry.id === task.id);
    if (currentTask) {
      currentTask.status = "running";
      currentTask.startedAt = new Date().toISOString();
      currentTask.attempts += 1;
      currentTask.runId = runId;
    }
    current.state.currentTaskId = task.id;
    return current;
  });

  addActivity("task", "Task check passed, starting task", {
    taskId: task.id,
    title: task.title,
    status: "running"
  });
  addActivity("task", "Task marked working", {
    taskId: task.id,
    title: task.title,
    status: "running"
  });
  addConsoleLine("task selected", {
    taskId: task.id,
    title: task.title,
    status: "running"
  });
  heartbeatTimer = startTaskHeartbeat(task);

  const duplicateCompletedTask = findCompletedTaskMatch(db.tasks, task, task.id);
  if (duplicateCompletedTask && !task.allowRerun) {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    const duplicateMessage = "Task already completed in bot. Skipped duplicate execution.";
    updateDb((current) => {
      const currentTask = current.tasks.find((entry) => entry.id === task.id);
      if (currentTask) {
        currentTask.status = "completed";
        currentTask.completedAt = new Date().toISOString();
        currentTask.lastOutput = duplicateMessage;
        currentTask.allowRerun = false;
      }
      current.state.isRunning = false;
      current.state.activeRunId = null;
      current.state.currentTaskId = null;
      current.state.lastResult = duplicateMessage;
      current.state.lastError = null;
      current.state.stopRequested = false;
      current.state.botOutputEntries = normalizeBotOutputEntries(current.state, current.notes, current.tasks);
      current.state.botOutput = current.state.botOutputEntries[0]?.text || duplicateMessage;
      return current;
    });
    addConsoleLine("duplicate completed task skipped", {
      taskId: task.id,
      title: task.title
    });

    appendBotOutput([
      "Task already completed in bot",
      new Date().toLocaleString(),
      "",
      `Skipped duplicate task: ${task.title}`
    ].join("\n"), "task");

    addActivity("task", "Task already completed in bot, skipping to next task", {
      taskId: task.id,
      existingTaskId: duplicateCompletedTask.id,
      title: task.title,
      status: "completed"
    });

    const latestDb = loadDb();
    scheduleNextRun(hasRunnableTask(latestDb) ? latestDb.config.postTaskDelaySeconds : latestDb.config.idleDelaySeconds);
    return getSnapshot();
  }

  if (!db.config.autoCallLlm) {
    const waitingMessage = "Auto call LLM is disabled. Task is waiting for AI.";
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    updateDb((current) => {
      const currentTask = current.tasks.find((entry) => entry.id === task.id);
      if (currentTask) {
        currentTask.status = "waiting";
        currentTask.lastOutput = waitingMessage;
        currentTask.allowRerun = Boolean(currentTask.allowRerun);
      }
      current.state.isRunning = false;
      current.state.activeRunId = null;
      current.state.currentTaskId = null;
      current.state.lastResult = waitingMessage;
      current.state.lastError = null;
      current.state.stopRequested = false;
      return current;
    });
    addConsoleLine("task moved to waiting because auto LLM is disabled", {
      taskId: task.id,
      title: task.title
    });

    appendBotOutput([
      `Task waiting: ${task.title}`,
      new Date().toLocaleString(),
      "",
      waitingMessage
    ].join("\n"), "task");

    addActivity("task", "Task moved to waiting because Auto call LLM is disabled", {
      taskId: task.id,
      title: task.title,
      status: "waiting"
    });

    updateExecFile({
      lastUpdated: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastTaskId: task.id,
      lastTaskStatus: "waiting"
    });

    scheduleNextRun(loadDb().config.idleDelaySeconds);
    return getSnapshot();
  }

  try {
    const prompt = buildLoopPrompt(task, db, workspace);
    const taskMode = inferTaskExecutionMode(task);
    const maxRuntimeMs = db.config.maxTaskRuntimeMinutes * 60 * 1000;
    addConsoleLine("calling AI task runner", {
      taskId: task.id,
      title: task.title,
      mode: taskMode
    });
    const aiResult = await withTimeout(
      runAiTask(prompt, {
        mode: taskMode,
        taskTitle: task.title,
        taskGoal: task.goal,
        assignedTaskBlock: task.assignedTaskBlock
      }),
      maxRuntimeMs,
      "Task run"
    );
    addConsoleLine("AI response received", {
      taskId: task.id,
      title: task.title
    });
    const appliedResult = applyAutonomousTaskResult(task, aiResult, db.config);
    addConsoleLine("autonomous result applied", {
      taskId: task.id,
      title: task.title,
      changedFiles: appliedResult.changedFiles
    });

    addConsoleLine("running git follow-up", {
      taskId: task.id,
      title: task.title
    });
    const gitResult = await withTimeout(
      maybeRunGitActions(task, db.config),
      maxRuntimeMs,
      "Git follow-up"
    );
    const completedAt = new Date().toISOString();
    const botOutput = buildRunSummary(task, appliedResult.output, gitResult, completedAt);

    const latestBeforeComplete = loadDb();
    const latestTaskBeforeComplete = latestBeforeComplete.tasks.find((entry) => entry.id === task.id);
    if (latestBeforeComplete.state.activeRunId !== runId || latestTaskBeforeComplete?.runId !== runId) {
      addConsoleLine("stale run result ignored after reset or override", {
        taskId: task.id,
        title: task.title,
        runId
      });
      return getSnapshot();
    }

    updateDb((current) => {
      const currentTask = current.tasks.find((entry) => entry.id === task.id);
      if (currentTask) {
        currentTask.status = "completed";
        currentTask.completedAt = completedAt;
        currentTask.lastOutput = appliedResult.output;
        currentTask.git = gitResult;
        currentTask.allowRerun = false;
        currentTask.runId = null;
      }
      current.state.isRunning = false;
      current.state.activeRunId = null;
      current.state.currentTaskId = null;
      current.state.lastResult = appliedResult.output;
      current.state.lastError = null;
      current.state.stopRequested = false;
      current.state.botOutputEntries = normalizeBotOutputEntries(current.state, current.notes, current.tasks);
      current.state.botOutput = current.state.botOutputEntries[0]?.text || botOutput;
      return current;
    });
    addConsoleLine("task completed successfully", {
      taskId: task.id,
      title: task.title,
      changedFiles: appliedResult.changedFiles
    });

    updateExecFile({
      lastUpdated: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastTaskId: task.id,
      lastTaskStatus: "completed"
    });

    addActivity("task", "Task completed successfully", {
      taskId: task.id,
      title: task.title,
      status: "completed",
      changedFiles: appliedResult.changedFiles
    });
  } catch (error) {
    updateDb((current) => {
      const currentTask = current.tasks.find((entry) => entry.id === task.id);
      const staleRun = current.state.activeRunId !== runId || currentTask?.runId !== runId;
      if (staleRun) {
        current.state.isRunning = false;
        current.state.activeRunId = null;
        current.state.currentTaskId = null;
        current.state.stopRequested = false;
        return current;
      }
      if (currentTask) {
        const retryLimitReached = currentTask.attempts >= current.config.maxRetries;
        currentTask.status = retryLimitReached ? "failed" : "pending";
        currentTask.lastError = error.message;
        currentTask.allowRerun = false;
        currentTask.runId = null;
      }
      current.state.isRunning = false;
      current.state.activeRunId = null;
      current.state.currentTaskId = null;
      current.state.lastError = error.message;
      current.state.lastResult = null;
      current.state.stopRequested = false;
      return current;
    });
    addConsoleLine("task failed", {
      taskId: task.id,
      title: task.title,
      error: error.message
    });

    appendBotOutput([
      `Run error for ${task.title}`,
      new Date().toLocaleString(),
      "",
      error.message
    ].join("\n"), "error");

    addActivity("error", "Task run failed", {
      taskId: task.id,
      title: task.title,
      error: error.message,
      status: loadDb().tasks.find((entry) => entry.id === task.id)?.status || "failed"
    });

    updateExecFile({
      lastUpdated: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastTaskId: task.id,
      lastTaskStatus: "failed"
    });
  }

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }

  const latestDb = loadDb();
  if (!latestDb.config.enabled) {
    clearScheduledRun();
    addConsoleLine("loop remains stopped after current run");
    return getSnapshot();
  }

  const currentTaskState = latestDb.tasks.find((entry) => entry.id === task.id);
  const hasQueuedTask = hasRunnableTask(latestDb);
  const delaySeconds = !latestDb.config.enabled
    ? latestDb.config.idleDelaySeconds
    : currentTaskState?.status === "pending"
      ? latestDb.config.retryDelaySeconds
      : hasQueuedTask
        ? latestDb.config.postTaskDelaySeconds
        : latestDb.config.idleDelaySeconds;

  scheduleNextRun(delaySeconds);
  return getSnapshot();
}

function startLoop() {
  const db = updateDb((current) => {
    current.config.enabled = true;
    current.state.stopRequested = false;
    return current;
  });

  addActivity("loop", "Bot loop enabled");
  addConsoleLine("loop enabled");
  if (hasRunnableTask(db)) {
    scheduleNextRun(1);
  } else if (db.config.pauseWhenQueueEmpty) {
    clearScheduledRun();
  } else {
    scheduleNextRun(db.config.idleDelaySeconds);
  }
  return db;
}

function stopLoop() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  const db = updateDb((current) => {
    current.config.enabled = false;
    current.state.nextRunAt = null;
    current.state.stopRequested = true;
    if (!current.state.isRunning) {
      current.state.stopRequested = false;
      current.state.activeRunId = null;
    }
    return current;
  });

  addActivity("loop", "Bot loop disabled");
  addConsoleLine(db.state.isRunning ? "stop requested while task is still running" : "loop stopped");
  return db;
}

function setConfig(patch) {
  const allowed = ["autoCallLlm", "autoCommit", "autoPush", "pauseWhenQueueEmpty", "idleDelaySeconds", "postTaskDelaySeconds", "retryDelaySeconds", "maxTaskRuntimeMinutes", "maxRetries", "enabled", "writableRoots", "protectedPaths"];

  const db = updateDb((current) => {
    for (const key of allowed) {
      if (Object.hasOwn(patch, key)) {
        current.config[key] = patch[key];
      }
    }

    current.config.idleDelaySeconds = Math.max(10, Number(current.config.idleDelaySeconds) || 45);
    current.config.postTaskDelaySeconds = Math.max(5, Number(current.config.postTaskDelaySeconds) || 15);
    current.config.retryDelaySeconds = Math.max(15, Number(current.config.retryDelaySeconds) || 90);
    current.config.maxTaskRuntimeMinutes = Math.max(1, Number(current.config.maxTaskRuntimeMinutes) || 20);
    current.config.maxRetries = Math.max(1, Number(current.config.maxRetries) || 2);
    current.config.writableRoots = Array.isArray(current.config.writableRoots)
      ? current.config.writableRoots.map((item) => String(item || "").trim().replaceAll("\\", "/")).filter(Boolean)
      : ["ai/"];
    current.config.protectedPaths = Array.isArray(current.config.protectedPaths)
      ? current.config.protectedPaths.map((item) => String(item || "").trim().replaceAll("\\", "/")).filter(Boolean)
      : [".env", ".data/", "server.js"];
    return current;
  });

  addActivity("config", "Bot config updated", {
    keys: Object.keys(patch)
  });

  if (db.config.enabled) {
    if (hasRunnableTask(db)) {
      scheduleNextRun(1);
    } else if (db.config.pauseWhenQueueEmpty) {
      clearScheduledRun();
    } else {
      scheduleNextRun(db.config.idleDelaySeconds);
    }
  }

  return db;
}

function addTask(payload) {
  if (!payload?.title?.trim()) {
    throw new Error("Task title is required");
  }

  const db = loadDb();
  const completedMatch = findCompletedTaskMatch(db.tasks, payload);
  if (completedMatch) {
    addActivity("task", "Task already completed in bot, duplicate blocked", {
      existingTaskId: completedMatch.id,
      title: completedMatch.title,
      status: "completed"
    });
    appendBotOutput([
      "Task already completed in bot",
      new Date().toLocaleString(),
      "",
      `Blocked duplicate task: ${payload.title.trim()}`
    ].join("\n"), "task");
    throw new Error("Task already completed in bot");
  }

  const task = {
    id: crypto.randomUUID(),
    order: db.tasks.length + 1,
    title: payload.title.trim(),
    goal: String(payload.goal || "").trim(),
    assignedTaskBlock: String(payload.assignedTaskBlock || "").trim(),
    status: "pending",
    locked: false,
    allowRerun: false,
    attempts: 0,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    lastOutput: null,
    lastError: null,
    git: null
  };

  updateDb((db) => {
    db.tasks.push(task);
    db.tasks = normalizeTaskOrder(db.tasks);
    return db;
  });

  addActivity("task", "Task added", {
    taskId: task.id,
    title: task.title
  });

  maybeWakeLoop("New task added, waking loop");

  return task;
}

function updateTask(taskId, patch) {
  const currentDb = loadDb();
  const existingTask = currentDb.tasks.find((entry) => entry.id === taskId);
  if (!existingTask) {
    throw new Error("Task not found");
  }

  const candidateTask = {
    ...existingTask,
    ...(Object.hasOwn(patch, "title") ? { title: String(patch.title || "").trim() || existingTask.title } : {}),
    ...(Object.hasOwn(patch, "goal") ? { goal: String(patch.goal || "").trim() } : {}),
    ...(Object.hasOwn(patch, "assignedTaskBlock") ? { assignedTaskBlock: String(patch.assignedTaskBlock || "").trim() } : {})
  };
  const completedMatch = findCompletedTaskMatch(currentDb.tasks, candidateTask, taskId);
  if (completedMatch) {
    addActivity("task", "Task already completed in bot, update blocked", {
      taskId,
      existingTaskId: completedMatch.id,
      title: completedMatch.title,
      status: "completed"
    });
    appendBotOutput([
      "Task already completed in bot",
      new Date().toLocaleString(),
      "",
      `Blocked duplicate task update: ${candidateTask.title}`
    ].join("\n"), "task");
    throw new Error("Task already completed in bot");
  }

  const db = updateDb((current) => {
    const task = current.tasks.find((entry) => entry.id === taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    if (patch.reset) {
      const archivedCreatedAt = new Date().toISOString();
      const resetResultText = task.lastOutput || [
        "Task was force-reset before completion.",
        `Previous status: ${task.status}`,
        `Started at: ${task.startedAt ? new Date(task.startedAt).toLocaleString() : "n/a"}`,
        `Last error: ${task.lastError || "none captured"}`,
        "No model output was captured before reset."
      ].join(" ");
      current.state.botOutputEntries = normalizeBotOutputEntries({
        ...current.state,
        botOutputEntries: [
          {
            id: crypto.randomUUID(),
            source: "task-reset-history",
            createdAt: archivedCreatedAt,
            text: [
              `Archived run before reset: ${task.title}`,
              new Date(archivedCreatedAt).toLocaleString(),
              "",
              buildRunSummary(
                task,
                resetResultText,
                task.git,
                task.completedAt || task.startedAt || task.createdAt || archivedCreatedAt
              )
            ].join("\n")
          },
          ...(current.state.botOutputEntries || [])
        ]
      }, current.notes, current.tasks);
      current.state.botOutput = current.state.botOutputEntries[0]?.text || current.state.botOutput;

      task.status = "waiting";
      task.allowRerun = true;
      task.startedAt = null;
      task.lastError = null;
      task.runId = null;
      if (current.state.currentTaskId === taskId) {
        current.state.isRunning = false;
        current.state.currentTaskId = null;
        current.state.activeRunId = null;
        current.state.stopRequested = false;
      }
      current.state.lastResult = `Task reset to waiting: ${task.title}`;
    }

    if (patch.status) {
      task.status = patch.status;
      if (patch.status !== "waiting") {
        task.allowRerun = false;
      }
    }

    if (Object.hasOwn(patch, "locked")) {
      task.locked = Boolean(patch.locked);
    }

    if (Object.hasOwn(patch, "title")) {
      task.title = String(patch.title || "").trim() || task.title;
    }

    if (Object.hasOwn(patch, "goal")) {
      task.goal = String(patch.goal || "").trim();
    }

    if (Object.hasOwn(patch, "assignedTaskBlock")) {
      task.assignedTaskBlock = String(patch.assignedTaskBlock || "").trim();
    }

    current.tasks = normalizeTaskOrder(current.tasks);
    return current;
  });

  addActivity("task", patch.reset ? "Task reset to waiting" : "Task updated", {
    taskId,
    status: patch.reset ? "waiting" : undefined,
    allowRerun: Boolean(patch.reset)
  });
  if (patch.reset) {
    addConsoleLine("task force-reset to waiting", {
      taskId,
      title: existingTask.title,
      previousStatus: existingTask.status
    });
  }

  const updatedTask = db.tasks.find((task) => task.id === taskId);
  if (updatedTask && (updatedTask.status === "pending" || updatedTask.status === "waiting") && !updatedTask.locked) {
    maybeWakeLoop("Pending task available, waking loop");
  }

  return updatedTask;
}

function reorderTasks(taskIds) {
  if (!Array.isArray(taskIds) || !taskIds.length) {
    throw new Error("Task order is required");
  }

  const db = updateDb((current) => {
    const currentIds = new Set(current.tasks.map((task) => task.id));
    if (current.tasks.length !== taskIds.length || taskIds.some((id) => !currentIds.has(id))) {
      throw new Error("Task order payload does not match current task set");
    }

    const taskMap = new Map(current.tasks.map((task) => [task.id, task]));
    current.tasks = taskIds.map((id, index) => ({
      ...taskMap.get(id),
      order: index + 1
    }));
    return current;
  });

  addActivity("task", "Tasks reordered");
  return normalizeTaskOrder(db.tasks);
}

function addGoal(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("Goal text is required");
  }

  const goal = {
    id: crypto.randomUUID(),
    text: trimmed,
    createdAt: new Date().toISOString()
  };

  updateDb((db) => {
    db.goals.unshift(goal);
    return db;
  });

  addActivity("goal", "Goal added", {
    goalId: goal.id
  });

  return goal;
}

function updateGoal(goalId, text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("Goal text is required");
  }

  const db = updateDb((current) => {
    const goal = current.goals.find((entry) => entry.id === goalId);
    if (!goal) {
      throw new Error("Goal not found");
    }

    goal.text = trimmed;
    goal.updatedAt = new Date().toISOString();
    return current;
  });

  addActivity("goal", "Goal updated", {
    goalId
  });

  return db.goals.find((goal) => goal.id === goalId);
}

function removeGoal(goalId) {
  updateDb((db) => {
    db.goals = db.goals.filter((goal) => goal.id !== goalId);
    return db;
  });

  addActivity("goal", "Goal removed", {
    goalId
  });
}

function addManualNote(title, body) {
  const safeTitle = String(title || "").trim();
  const safeBody = String(body || "").trim();

  if (!safeTitle || !safeBody) {
    throw new Error("Note title and body are required");
  }

  addNote(safeTitle, safeBody);
  appendBotOutput([
    `Manual note: ${safeTitle}`,
    new Date().toLocaleString(),
    "",
    safeBody
  ].join("\n"), "note");
  addActivity("note", "Manual note added");
}

function removeNote(noteId) {
  let removed = null;

  updateDb((db) => {
    removed = db.notes.find((note) => note.id === noteId) || null;
    db.notes = db.notes.filter((note) => note.id !== noteId);
    return db;
  });

  if (!removed) {
    throw new Error("Note not found");
  }

  addActivity("note", "Manual note deleted", {
    noteId
  });
}

function getSnapshot() {
  const db = loadDb();
  return {
    config: db.config,
    state: db.state,
    goals: db.goals,
    tasks: normalizeTaskOrder(db.tasks),
    notes: db.notes,
    activity: db.activity,
    git: null
  };
}

function bootstrapLoop() {
  const db = loadDb();
  saveDb(db);
  if (db.config.enabled) {
    addActivity("loop", "Bot loop restored on server start");
    if (hasRunnableTask(db)) {
      scheduleNextRun(2);
    } else if (!db.config.pauseWhenQueueEmpty) {
      scheduleNextRun(db.config.idleDelaySeconds);
    } else {
      clearScheduledRun();
    }
  }
}

module.exports = {
  addGoal,
  addManualNote,
  addTask,
  bootstrapLoop,
  getGitSnapshot,
  getSnapshot,
  removeGoal,
  removeNote,
  reorderTasks,
  runLoopCycle,
  setConfig,
  startLoop,
  stopLoop,
  updateGoal,
  updateTask
};
