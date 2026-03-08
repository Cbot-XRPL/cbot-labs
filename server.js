const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
require("dotenv").config();

const aiRuntime = require("./ai-runtime");
const { getAiSummary, runAiTask } = require("./ai-service");

const app = express();
const rootDir = __dirname;
const dataDir = path.join(rootDir, ".data");
const sessionsFile = path.join(dataDir, "sessions.json");
const xahauTomlPath = path.join(rootDir, ".well-known", "xahau.toml");
const projectRoot = path.join(rootDir, "admin-projects");
const sessionCookieName = "cbot_session";

app.use(express.json({ limit: "2mb" }));

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function readToml(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_error) {
    return "";
  }
}

function extractTomlValue(toml, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = toml.match(new RegExp(`^${escapedKey}\\s*=\\s*"([^"]*)"`, "m"));
  return match ? match[1] : "";
}

function getValidatorConfig() {
  const toml = readToml(xahauTomlPath);
  return {
    publicKey: extractTomlValue(toml, "public_key") || "nHUCQgftpGqfDAY7XMCXPbyBBvGRg9T6n1YMnmaG2trnrYeywAjL",
    account: extractTomlValue(toml, "address") || "rCboTXmnomVJzRKVXqDMDFzwTaCKFAcYs",
    networkId: extractTomlValue(toml, "network") || "21337",
    domain: extractTomlValue(toml, "domain") || "https://cbotlabs.xyz",
    principalTwitter: extractTomlValue(toml, "twitter") || "@Cbot_Xrpl",
    principalEmail: extractTomlValue(toml, "email") || "admin@cbotlabs.xyz",
    organizationTwitter: (() => {
      const matches = [...toml.matchAll(/^twitter\s*=\s*"([^"]*)"/gm)].map((match) => match[1]).filter(Boolean);
      return matches[matches.length - 1] || "@cbotlabs";
    })(),
    organizationEmail: (() => {
      const matches = [...toml.matchAll(/^email\s*=\s*"([^"]*)"/gm)].map((match) => match[1]).filter(Boolean);
      return matches[matches.length - 1] || "admin@cbotlabs.xyz";
    })(),
    location: extractTomlValue(toml, "server_location").replace(/\s*-\s*/g, ", ") || "Atlanta, US",
    tomlUrl: "https://cbotlabs.xyz/.well-known/xahau.toml",
    unlUrl: "https://xahau.network/unl",
    status: "active",
    network: "Xahau Mainnet"
  };
}

function getOwnerAccounts() {
  const configured = String(process.env.OWNER_WALLETS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length) {
    return configured;
  }

  return [getValidatorConfig().account];
}

function parseCookies(headerValue) {
  return String(headerValue || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = decodeURIComponent(part.slice(0, separatorIndex).trim());
      const value = decodeURIComponent(part.slice(separatorIndex + 1).trim());
      accumulator[key] = value;
      return accumulator;
    }, {});
}

function loadSessions() {
  ensureDataDir();

  if (!fs.existsSync(sessionsFile)) {
    fs.writeFileSync(sessionsFile, "[]\n");
    return new Map();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(sessionsFile, "utf8"));
    return new Map(Array.isArray(parsed) ? parsed : []);
  } catch (_error) {
    return new Map();
  }
}

function saveSessions(sessionMap) {
  ensureDataDir();
  fs.writeFileSync(sessionsFile, `${JSON.stringify(Array.from(sessionMap.entries()), null, 2)}\n`);
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[sessionCookieName];
  if (!sessionId) {
    return null;
  }

  const sessions = loadSessions();
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  return {
    id: sessionId,
    ...session
  };
}

function isOwnerAccount(account) {
  return Boolean(account) && getOwnerAccounts().includes(String(account).trim());
}

function getAuthState(req) {
  const session = getSession(req);
  return {
    configured: Boolean(process.env.XAMAN_API_KEY && process.env.XAMAN_API_SECRET),
    loggedIn: Boolean(session?.account),
    account: session?.account || null,
    isOwner: isOwnerAccount(session?.account)
  };
}

function setSessionCookie(res, sessionId) {
  res.setHeader("Set-Cookie", `${sessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireOwner(req, res, next) {
  const session = getSession(req);
  if (session?.account && isOwnerAccount(session.account)) {
    req.ownerAccount = session.account;
    return next();
  }

  const headerAccount = String(req.header("x-owner-wallet") || req.query["x-owner-wallet"] || "").trim();
  if (isOwnerAccount(headerAccount)) {
    req.ownerAccount = headerAccount;
    return next();
  }

  return res.status(403).json({ error: "Owner access required" });
}

function getAppPayload() {
  const validator = getValidatorConfig();
  return {
    brand: {
      name: "Cbot Labs",
      tagline: "Xahau UNL Validator",
      summary: "Local-first interface for validator identity, Xaman auth, and private operator controls.",
      logo: "/ll.png"
    },
    validator: {
      status: validator.status,
      network: validator.network,
      networkId: validator.networkId,
      account: validator.account,
      location: validator.location,
      publicKey: validator.publicKey,
      unlUrl: validator.unlUrl,
      tomlUrl: validator.tomlUrl
    },
    auth: {
      ownerAccount: getOwnerAccounts()[0]
    },
    modules: [
      {
        name: "Validator status",
        description: "Live identity and validator metadata sourced from the local app.",
        status: "Online"
      },
      {
        name: "Admin bot",
        description: "Owner-only task runner, console, notes, and autonomous workspace controls.",
        status: "Private"
      },
      {
        name: "Project hub",
        description: "Owner-only project area for bot-built interfaces and backend experiments.",
        status: "Active"
      }
    ],
    links: [
      {
        label: "Email",
        href: validator.organizationEmail || validator.principalEmail
      },
      {
        label: "Twitter",
        href: validator.principalTwitter || "@Cbot_Xrpl"
      },
      {
        label: "GitHub",
        href: "https://github.com/Cbot-XRPL"
      }
    ]
  };
}

function getXamanSdk() {
  if (!process.env.XAMAN_API_KEY || !process.env.XAMAN_API_SECRET) {
    return null;
  }

  try {
    const { XummSdk } = require("xumm-sdk");
    return new XummSdk(process.env.XAMAN_API_KEY, process.env.XAMAN_API_SECRET);
  } catch (_error) {
    try {
      const { XummSdk } = require("xumm");
      return new XummSdk(process.env.XAMAN_API_KEY, process.env.XAMAN_API_SECRET);
    } catch (_innerError) {
      return null;
    }
  }
}

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development"
  });
});

app.get("/api/app", (_req, res) => {
  res.json(getAppPayload());
});

app.get("/api/auth/session", (req, res) => {
  res.json(getAuthState(req));
});

app.post("/api/auth/xaman/start", async (_req, res) => {
  const sdk = getXamanSdk();
  if (!sdk) {
    return res.status(400).json({ error: "Xaman is not configured on the server" });
  }

  try {
    const created = await sdk.payload.create({
      txjson: {
        TransactionType: "SignIn"
      },
      options: {
        submit: false,
        expire: 5
      },
      custom_meta: {
        instruction: "Sign in to Cbot Labs owner console"
      }
    }, true);

    res.json({
      uuid: created?.uuid || created?.next?.uuid || null,
      always: created?.next?.always || null,
      qrPng: created?.refs?.qr_png || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unable to start Xaman login" });
  }
});

app.get("/api/auth/xaman/poll/:uuid", async (req, res) => {
  const sdk = getXamanSdk();
  if (!sdk) {
    return res.status(400).json({ error: "Xaman is not configured on the server" });
  }

  try {
    const payload = await sdk.payload.get(req.params.uuid, true);
    const resolved = Boolean(payload?.meta?.resolved || payload?.response?.resolved);
    const signed = Boolean(payload?.meta?.signed || payload?.response?.signed);
    const account = payload?.response?.account || payload?.response?.payload_uuidv4 || null;

    if (!resolved) {
      return res.json({ resolved: false });
    }

    if (!signed || !account) {
      return res.json({ resolved: true, signed: false });
    }

    const sessions = loadSessions();
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      createdAt: Date.now(),
      account
    });
    saveSessions(sessions);
    setSessionCookie(res, sessionId);

    return res.json({
      resolved: true,
      signed: true,
      account,
      isOwner: isOwnerAccount(account)
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to poll Xaman payload" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const session = getSession(req);
  if (session?.id) {
    const sessions = loadSessions();
    sessions.delete(session.id);
    saveSessions(sessions);
  }

  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/toml/xahau", (_req, res) => {
  try {
    res.type("text/plain; charset=utf-8").send(fs.readFileSync(xahauTomlPath, "utf8"));
  } catch (error) {
    res.status(500).json({ error: error.message || "Unable to read TOML file" });
  }
});

app.get("/api/admin", requireOwner, (_req, res) => {
  res.json({
    ownerAccount: getOwnerAccounts()[0],
    controls: [
      "owner session",
      "ai runtime",
      "task queue",
      "project hub",
      "guarded commands"
    ],
    ai: getAiSummary()
  });
});

app.post("/api/admin/ai/run", requireOwner, async (req, res) => {
  try {
    const result = await runAiTask(req.body?.prompt, { mode: "text" });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || "Manual AI run failed" });
  }
});

app.get("/api/admin/bot", requireOwner, async (_req, res) => {
  try {
    const snapshot = aiRuntime.getSnapshot();
    const git = await aiRuntime.getGitSnapshot();
    res.json({
      ...snapshot,
      git
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unable to load bot snapshot" });
  }
});

app.post("/api/admin/bot/config", requireOwner, (req, res) => {
  try {
    res.json(aiRuntime.setConfig(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to save bot config" });
  }
});

app.post("/api/admin/bot/start", requireOwner, (_req, res) => {
  try {
    res.json(aiRuntime.startLoop());
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to start bot loop" });
  }
});

app.post("/api/admin/bot/stop", requireOwner, (_req, res) => {
  try {
    res.json(aiRuntime.stopLoop());
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to stop bot loop" });
  }
});

app.post("/api/admin/bot/run", requireOwner, async (_req, res) => {
  try {
    await aiRuntime.runLoopCycle();
    res.json(aiRuntime.getSnapshot());
  } catch (error) {
    res.status(500).json({ error: error.message || "Bot run failed" });
  }
});

app.post("/api/admin/bot/commands/:name", requireOwner, async (req, res) => {
  try {
    const result = await aiRuntime.runAllowedCommand(req.params.name);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ error: error.message || "Command failed" });
  }
});

app.post("/api/admin/bot/tasks", requireOwner, (req, res) => {
  try {
    res.json(aiRuntime.addTask(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to add task" });
  }
});

app.patch("/api/admin/bot/tasks/:taskId", requireOwner, (req, res) => {
  try {
    res.json(aiRuntime.updateTask(req.params.taskId, req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to update task" });
  }
});

app.delete("/api/admin/bot/tasks/:taskId", requireOwner, (req, res) => {
  try {
    res.json(aiRuntime.removeTask(req.params.taskId));
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to delete task" });
  }
});

app.post("/api/admin/bot/tasks/reorder", requireOwner, (req, res) => {
  try {
    res.json(aiRuntime.reorderTasks(req.body?.taskIds || []));
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to reorder tasks" });
  }
});

app.post("/api/admin/bot/goals", requireOwner, (req, res) => {
  try {
    res.json(aiRuntime.addGoal(req.body?.text));
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to add goal" });
  }
});

app.patch("/api/admin/bot/goals/:goalId", requireOwner, (req, res) => {
  try {
    res.json(aiRuntime.updateGoal(req.params.goalId, req.body?.text));
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to update goal" });
  }
});

app.delete("/api/admin/bot/goals/:goalId", requireOwner, (req, res) => {
  try {
    aiRuntime.removeGoal(req.params.goalId);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to remove goal" });
  }
});

app.post("/api/admin/bot/notes", requireOwner, (req, res) => {
  try {
    aiRuntime.addManualNote(req.body?.title, req.body?.body);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to save note" });
  }
});

app.delete("/api/admin/bot/notes/:noteId", requireOwner, (req, res) => {
  try {
    aiRuntime.removeNote(req.params.noteId);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to delete note" });
  }
});

try {
  const adminTradingRouter = require("./routes/admin-trading");
  app.use("/api/admin/trading", requireOwner, adminTradingRouter);
} catch (error) {
  console.error("Failed to mount admin trading routes:", error.message);
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.get("/index.html", (_req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.get("/script.js", (_req, res) => {
  res.type("application/javascript").sendFile(path.join(rootDir, "script.js"));
});

app.get("/style.css", (_req, res) => {
  res.type("text/css").sendFile(path.join(rootDir, "style.css"));
});

app.get("/favicon.ico", (_req, res) => {
  res.sendFile(path.join(rootDir, "favicon.ico"));
});

app.get("/ll.png", (_req, res) => {
  res.sendFile(path.join(rootDir, "ll.png"));
});

app.use("/media", express.static(path.join(rootDir, "media")));
app.use("/.well-known", express.static(path.join(rootDir, ".well-known")));
app.use("/admin/projects", requireOwner, express.static(projectRoot, { index: "index.html" }));
app.use("/admin-projects", requireOwner, express.static(projectRoot, { index: "index.html" }));

app.get("/admin/trading", requireOwner, (_req, res) => {
  res.redirect("/admin/projects/xrpl-trading-bot/");
});

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});

aiRuntime.bootstrapLoop();

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Cbot Labs listening on http://localhost:${port}`);
});
