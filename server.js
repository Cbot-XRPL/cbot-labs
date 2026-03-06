require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Xumm } = require("xumm");

const app = express();
const port = process.env.PORT || 3000;
const rootDir = __dirname;
const wellKnownDir = path.join(rootDir, ".well-known");
const dataDir = path.join(rootDir, ".data");
const sessionsFile = path.join(dataDir, "sessions.json");
const ownerAccount = "rCboTXmnomVJzRKVXqDMDFzwTaCKFAcYs";
const sessionCookieName = "cbot_session";
const sessionTtlMs = 1000 * 60 * 60 * 12;
const pendingAuthTtlMs = 1000 * 60 * 10;

const sessions = new Map();
const pendingAuth = new Map();

const xamanApiKey = process.env.XAMAN_API_KEY || process.env.XUMM_API_KEY || "";
const xamanApiSecret = process.env.XAMAN_API_SECRET || process.env.XUMM_API_SECRET || "";
const xamanConfigured = Boolean(xamanApiKey && xamanApiSecret);
const xumm = xamanConfigured ? new Xumm(xamanApiKey, xamanApiSecret) : null;

fs.mkdirSync(dataDir, { recursive: true });

const appData = {
  brand: {
    name: "Cbot Labs",
    tagline: "Xahau UNL Validator",
    summary: "Local-first interface for validator identity, Xaman auth, and private operator controls.",
    logo: "/ll.png"
  },
  validator: {
    publicKey: "nHUCQgftpGqfDAY7XMCXPbyBBvGRg9T6n1YMnmaG2trnrYeywAjL",
    account: ownerAccount,
    network: "Xahau Mainnet",
    networkId: 21337,
    status: "active",
    location: "Atlanta, US",
    tomlUrl: "https://cbotlabs.xyz/.well-known/xahau.toml",
    unlUrl: "https://xahauexplorer.com/en/validators"
  },
  links: [
    {
      label: "Email",
      href: "mailto:admin@cbotlabs.xyz"
    },
    {
      label: "Twitter",
      href: "https://twitter.com/Cbot_Xrpl"
    },
    {
      label: "GitHub",
      href: "https://github.com/Cbot-XRPL"
    }
  ],
  modules: [
    {
      name: "Admin",
      description: "Private panel that only renders when the authenticated account matches the owner wallet.",
      status: "ready"
    },
    {
      name: "Cutting Edge NFT Marketplace on Xahau",
      description: "Construct a one of a kind marketplace on Xahau with hooks.",
      status: "building"
    },
    {
      name: "AI Engine",
      description: "Experiment with blockchain, LLMs and VMs to increase work productivity.",
      status: "building"
    }
  ]
};

app.use(express.json());

app.use((req, res, next) => {
  if (req.path.endsWith(".toml")) {
    res.type("application/toml");
    res.set("Access-Control-Allow-Origin", "*");
  }
  next();
});

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) {
    return {};
  }

  return header.split(";").reduce((cookies, item) => {
    const [name, ...valueParts] = item.trim().split("=");
    cookies[name] = decodeURIComponent(valueParts.join("="));
    return cookies;
  }, {});
}

function pruneStore(store, ttlMs) {
  const now = Date.now();

  for (const [key, value] of store.entries()) {
    if (now - value.createdAt > ttlMs) {
      store.delete(key);
    }
  }
}

function loadSessions() {
  try {
    if (!fs.existsSync(sessionsFile)) {
      return;
    }

    const raw = fs.readFileSync(sessionsFile, "utf8");
    if (!raw.trim()) {
      return;
    }

    const entries = JSON.parse(raw);
    for (const [sessionId, session] of entries) {
      sessions.set(sessionId, session);
    }
  } catch (error) {
    console.error("Failed to load sessions:", error);
  }
}

function persistSessions() {
  try {
    fs.writeFileSync(sessionsFile, JSON.stringify([...sessions.entries()], null, 2));
  } catch (error) {
    console.error("Failed to persist sessions:", error);
  }
}

function getSession(req) {
  pruneStore(sessions, sessionTtlMs);
  persistSessions();
  const cookies = parseCookies(req);
  const sessionId = cookies[sessionCookieName];

  if (!sessionId) {
    return null;
  }

  return sessions.get(sessionId) || null;
}

function buildAuthState(req) {
  const session = getSession(req);

  return {
    configured: xamanConfigured,
    loggedIn: Boolean(session),
    account: session?.account || null,
    isOwner: session?.account === ownerAccount
  };
}

function requireOwner(req, res, next) {
  const session = getSession(req);

  if (!session || session.account !== ownerAccount) {
    res.status(403).json({
      ok: false,
      error: "Owner session required"
    });
    return;
  }

  next();
}

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    app: appData.brand.name,
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/app", (req, res) => {
  res.json({
    ...appData,
    auth: {
      ownerAccount,
      xamanConfigured
    }
  });
});

app.get("/api/validator", (req, res) => {
  res.json(appData.validator);
});

app.get("/api/links", (req, res) => {
  res.json(appData.links);
});

app.get("/api/modules", (req, res) => {
  res.json(appData.modules);
});

app.get("/api/auth/session", (req, res) => {
  res.json(buildAuthState(req));
});

app.post("/api/auth/logout", (req, res) => {
  const cookies = parseCookies(req);
  if (cookies[sessionCookieName]) {
    sessions.delete(cookies[sessionCookieName]);
    persistSessions();
  }

  res.setHeader("Set-Cookie", `${sessionCookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.post("/api/auth/xaman/start", async (req, res) => {
  if (!xamanConfigured) {
    res.status(503).json({
      ok: false,
      error: "Xaman credentials are not configured on the server"
    });
    return;
  }

  try {
    const origin = `${req.protocol}://${req.get("host")}`;
    const payload = await xumm.payload.create({
      txjson: {
        TransactionType: "SignIn"
      },
      custom_meta: {
        identifier: "cbot-labs-admin-login",
        instruction: "Sign in to Cbot Labs admin"
      },
      options: {
        return_url: {
          app: `${origin}/`,
          web: `${origin}/`
        }
      }
    });

    pendingAuth.set(payload.uuid, {
      createdAt: Date.now()
    });

    res.json({
      ok: true,
      uuid: payload.uuid,
      qrPng: payload.refs?.qr_png || null,
      always: payload.next?.always || null
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Failed to create Xaman sign-in payload"
    });
  }
});

app.get("/api/auth/xaman/poll/:uuid", async (req, res) => {
  if (!xamanConfigured) {
    res.status(503).json({
      ok: false,
      error: "Xaman credentials are not configured on the server"
    });
    return;
  }

  pruneStore(pendingAuth, pendingAuthTtlMs);
  const pending = pendingAuth.get(req.params.uuid);

  if (!pending) {
    res.status(404).json({
      ok: false,
      error: "Unknown or expired login request"
    });
    return;
  }

  try {
    const payload = await xumm.payload.get(req.params.uuid);
    const signed = payload?.meta?.signed === true;
    const account = payload?.response?.account || null;

    if (!signed) {
      res.json({
        ok: true,
        resolved: false
      });
      return;
    }

    pendingAuth.delete(req.params.uuid);

    if (!account) {
      res.status(400).json({
        ok: false,
        error: "Signed payload did not include an account"
      });
      return;
    }

    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      createdAt: Date.now(),
      account
    });
    persistSessions();

    res.setHeader("Set-Cookie", `${sessionCookieName}=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(sessionTtlMs / 1000)}`);
    res.json({
      ok: true,
      resolved: true,
      account,
      isOwner: account === ownerAccount
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Failed to poll Xaman payload"
    });
  }
});

app.get("/api/admin", requireOwner, (req, res) => {
  res.json({
    ok: true,
    ownerAccount,
    controls: [
      "Build private panel with wallet authentication",
      "Back server and VMs",
      "Add higher quality error tracking"
    ]
  });
});

app.use("/.well-known", express.static(wellKnownDir));
app.use(express.static(rootDir, {
  maxAge: "1h",
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache");
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=3600");
  }
}));

app.get("/", (req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

function getNetworkUrls(activePort) {
  const interfaces = os.networkInterfaces();
  const urls = [];

  for (const entries of Object.values(interfaces)) {
    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${activePort}`);
      }
    }
  }

  return urls;
}

loadSessions();

if (require.main === module) {
  const server = app.listen(port, () => {
    console.log(`Cbot Labs server listening on http://localhost:${port}`);

    const networkUrls = getNetworkUrls(port);
    for (const url of networkUrls) {
      console.log(`Network access: ${url}`);
    }
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Stop the other server or set PORT to a different value.`);
      return;
    }

    console.error("Server failed to start:", error);
  });
}

module.exports = app;
