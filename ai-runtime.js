const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { getAiWorkspace, runAiTask } = require("./ai-service");

const execFileAsync = promisify(execFile);

const dataDir = path.join(__dirname, ".data");
const botDbFile = path.join(dataDir, "bot-db.json");
const execFilePath = path.join(__dirname, "ai", "exec.json");
const notesLimit = 80;
const activityLimit = 250;
const botOutputLimit = 120;
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
      maxRetries: 2
    },
    goals: [],
    tasks: [],
    notes: [],
    activity: [],
    state: {
      isRunning: false,
      currentTaskId: null,
      lastRunAt: null,
      nextRunAt: null,
      lastResult: null,
      lastError: null,
      botOutput: null,
      botOutputEntries: [],
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
    const key = `${createdAt}|${source}|${text}`;
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

  if (!Array.isArray(state.botOutputEntries) || !state.botOutputEntries.length) {
    for (const task of tasks) {
      if (task.status !== "completed" || !task.lastOutput) {
        continue;
      }

      pushEntry({
        source: "completed-task",
        createdAt: task.completedAt || task.startedAt || task.createdAt,
        text: buildRunSummary(task, task.lastOutput, task.git)
      });
    }

    for (const note of notes) {
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

function buildRunSummary(task, resultText, gitResult) {
  return [
    `Run result for ${task.title}`,
    new Date().toLocaleString(),
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

  return [
    "You are the admin-only Cbot Labs automation agent.",
    "Read the AI docs and work the assigned task block.",
    `Task title: ${task.title}`,
    `Task goal: ${task.goal || "No explicit goal provided"}`,
    "Assigned task block:",
    taskBlock,
    "Active goals:",
    goalsText,
    `Manifest: ${workspace.manifest.name} v${workspace.manifest.version}`
  ].join("\n");
}

async function runLoopCycle() {
  const initialDb = loadDb();

  if (initialDb.state.isRunning) {
    addActivity("loop", "Skipped cycle because a run is already active");
    return getSnapshot();
  }

  updateDb((db) => {
    db.state.isRunning = true;
    db.state.lastError = null;
    db.state.lastRunAt = new Date().toISOString();
    db.state.runCount += 1;
    return db;
  });

  addActivity("loop", "Bot cycle started");

  let db = loadDb();
  const task = getPendingTask(db);
  const workspace = getAiWorkspace();
  let heartbeatTimer = null;

  if (!task) {
    addActivity("loop", "Queue check complete: no runnable task found");
    updateExecFile({
      lastUpdated: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastTaskId: null,
      lastTaskStatus: "idle"
    });

    updateDb((current) => {
      current.state.isRunning = false;
      current.state.currentTaskId = null;
      current.state.lastResult = initialDb.config.pauseWhenQueueEmpty
        ? "Queue empty, loop paused"
        : "Idle";
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
  heartbeatTimer = startTaskHeartbeat(task);

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
      }
      current.state.isRunning = false;
      current.state.currentTaskId = null;
      current.state.lastResult = waitingMessage;
      current.state.lastError = null;
      return current;
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
    const maxRuntimeMs = db.config.maxTaskRuntimeMinutes * 60 * 1000;
    const aiResult = await withTimeout(
      runAiTask(prompt),
      maxRuntimeMs,
      "Task run"
    );

    const gitResult = await withTimeout(
      maybeRunGitActions(task, db.config),
      maxRuntimeMs,
      "Git follow-up"
    );
    const botOutput = buildRunSummary(task, aiResult.output, gitResult);

    updateDb((current) => {
      const currentTask = current.tasks.find((entry) => entry.id === task.id);
      if (currentTask) {
        currentTask.status = "completed";
        currentTask.completedAt = new Date().toISOString();
        currentTask.lastOutput = aiResult.output;
        currentTask.git = gitResult;
      }
      current.state.isRunning = false;
      current.state.currentTaskId = null;
      current.state.lastResult = aiResult.output;
      current.state.lastError = null;
      return current;
    });

    appendBotOutput(botOutput, "task");

    updateExecFile({
      lastUpdated: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastTaskId: task.id,
      lastTaskStatus: "completed"
    });

    addActivity("task", "Task completed successfully", {
      taskId: task.id,
      title: task.title,
      status: "completed"
    });
  } catch (error) {
    updateDb((current) => {
      const currentTask = current.tasks.find((entry) => entry.id === task.id);
      if (currentTask) {
        const retryLimitReached = currentTask.attempts >= current.config.maxRetries;
        currentTask.status = retryLimitReached ? "failed" : "pending";
        currentTask.lastError = error.message;
      }
      current.state.isRunning = false;
      current.state.currentTaskId = null;
      current.state.lastError = error.message;
      current.state.lastResult = null;
      return current;
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
    return current;
  });

  addActivity("loop", "Bot loop enabled");
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
    current.state.isRunning = false;
    return current;
  });

  addActivity("loop", "Bot loop disabled");
  return db;
}

function setConfig(patch) {
  const allowed = ["autoCallLlm", "autoCommit", "autoPush", "pauseWhenQueueEmpty", "idleDelaySeconds", "postTaskDelaySeconds", "retryDelaySeconds", "maxTaskRuntimeMinutes", "maxRetries", "enabled"];

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
      task.status = "waiting";
      task.attempts = 0;
      task.startedAt = null;
      task.completedAt = null;
      task.lastError = null;
      task.lastOutput = null;
      task.git = null;
    }

    if (patch.status) {
      task.status = patch.status;
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
    status: patch.reset ? "waiting" : undefined
  });

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
  reorderTasks,
  runLoopCycle,
  setConfig,
  startLoop,
  stopLoop,
  updateGoal,
  updateTask
};
