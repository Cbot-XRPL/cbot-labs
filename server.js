const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
require("dotenv").config();

const app = express();
const rootDir = __dirname;
const dataDir = path.join(rootDir, ".data");
const sessionsFile = path.join(dataDir, "sessions.json");
const xahauTomlPath = path.join(rootDir, ".well-known", "xahau.toml");
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
    unlUrl: "https://xahau.xrplwin.com/validators",
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

function getAppPayload() {
  const validator = getValidatorConfig();
  return {
    brand: {
      name: "Cbot Labs",
      tagline: "Builders on the XRP Ledger & Xahau",
      summary: "We run infrastructure and ship products for the XRPL ecosystem — from a mainnet Xahau UNL validator and a free public node to oneXah, native DeFi app.",
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
    projects: [
      {
        name: "oneXah DeFi",
        description: "Our DeFi app on Xahau — swap, manage and put your XRPL assets to work in a clean, fast interface.",
        url: "https://onexah.io/defi/",
        status: "Live"
      }
    ],
    auth: {
      ownerAccount: getOwnerAccounts()[0]
    },
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

/* ── Xahau cluster ─────────────────────────────────────────────────────────
 * Two very different surfaces, and the difference is the point:
 *
 *   /api/cluster        PUBLIC. Built only from public RPC replies, so it can
 *                       reveal nothing a visitor could not fetch themselves.
 *   /api/cluster/admin  OWNER ONLY. Proxies the ops dashboard, which exposes
 *                       internal addresses, VM ids and disk state. The gate is
 *                       enforced HERE, server-side — the browser never gets the
 *                       payload to hide. A client-side check would ship the
 *                       data and politely ask the page not to render it.
 */
const CLUSTER = {
  publicRpc: process.env.CLUSTER_RPC_PUBLIC || "https://cluster.cbotlabs.xyz",
  publicWs: process.env.CLUSTER_WS_PUBLIC || "wss://ws-cluster.cbotlabs.xyz",
  // label=url pairs; these are LAN addresses and never leave the server
  nodes: (process.env.CLUSTER_NODES ||
    "xah-node-1 (deep)=http://192.168.1.110:5007,xah-node-2 (api)=http://192.168.1.111:5007")
    .split(",").map((spec) => {
      const i = spec.indexOf("=");
      return { label: spec.slice(0, i).trim(), url: spec.slice(i + 1).trim() };
    }).filter((n) => n.label && n.url),
  opsUrl: process.env.CLUSTER_OPS_URL || "http://192.168.1.110:8088",
  ttlMs: Number(process.env.CLUSTER_TTL_MS || 15000)
};

const clusterCache = { at: 0, payload: null };

async function fetchJson(url, { method = "GET", body, timeoutMs = 6000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseLedgerRange(complete) {
  if (!complete || !complete.includes("-")) return {};
  const last = String(complete).split(",").pop();
  const [lowRaw, highRaw] = last.split("-");
  const low = Number(lowRaw);
  const high = Number(highRaw);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return {};
  return { low, high, count: high - low + 1 };
}

async function collectCluster() {
  const nodes = await Promise.all(CLUSTER.nodes.map(async (n) => {
    try {
      const reply = await fetchJson(n.url, { method: "POST", body: { method: "server_info", params: [{}] } });
      const info = reply?.result?.info || {};
      // Whitelist. Never spread `info` — a future xahaud could add a field we
      // have not thought about and it would be public the moment it shipped.
      return {
        label: n.label,
        reachable: true,
        serverState: info.server_state || null,
        completeLedgers: info.complete_ledgers || null,
        ...parseLedgerRange(info.complete_ledgers),
        validatedSeq: info.validated_ledger?.seq ?? null,
        ledgerAgeS: info.validated_ledger?.age ?? null,
        peers: info.peers ?? null,
        build: info.build_version || null,
        networkId: info.network_id ?? null,
        uptimeS: info.uptime ?? null,
        pubkeyNode: info.pubkey_node || null
      };
    } catch (error) {
      return { label: n.label, reachable: false, error: error.name === "AbortError" ? "timeout" : "unreachable" };
    }
  }));

  const up = nodes.filter((n) => n.reachable);
  const synced = up.filter((n) => ["full", "proposing", "validating"].includes(n.serverState));
  return {
    ts: Date.now(),
    network: "Xahau Mainnet",
    networkId: up[0]?.networkId ?? 21337,
    endpoints: { rpc: CLUSTER.publicRpc, ws: CLUSTER.publicWs },
    health: synced.length === nodes.length ? "ok" : (synced.length ? "degraded" : "down"),
    nodesUp: up.length,
    nodesTotal: nodes.length,
    validatedSeq: up.reduce((m, n) => Math.max(m, n.validatedSeq || 0), 0) || null,
    historyLedgers: up.reduce((m, n) => Math.max(m, n.count || 0), 0) || null,
    peers: up.reduce((m, n) => Math.max(m, n.peers || 0), 0) || null,
    nodes
  };
}

app.get("/api/cluster", async (_req, res) => {
  const now = Date.now();
  if (clusterCache.payload && now - clusterCache.at < CLUSTER.ttlMs) {
    return res.json(clusterCache.payload);
  }
  try {
    const payload = await collectCluster();
    clusterCache.at = now;
    clusterCache.payload = payload;
    res.json(payload);
  } catch (_error) {
    // Serve stale rather than nothing — a momentary blip should not blank the
    // pane on a page that is otherwise fine.
    if (clusterCache.payload) return res.json({ ...clusterCache.payload, stale: true });
    res.status(503).json({ error: "cluster unavailable" });
  }
});

function requireOwner(req, res, next) {
  const session = getSession(req);
  if (!session?.account) {
    return res.status(401).json({ error: "not signed in" });
  }
  if (!isOwnerAccount(session.account)) {
    return res.status(403).json({ error: "not an owner account" });
  }
  return next();
}

app.get("/api/cluster/admin", requireOwner, async (_req, res) => {
  try {
    const state = await fetchJson(`${CLUSTER.opsUrl}/api/state`, { timeoutMs: 12000 });
    res.json(state);
  } catch (error) {
    res.status(502).json({
      error: "ops dashboard unreachable",
      detail: error.name === "AbortError" ? "timeout" : String(error.message || error),
      opsUrl: CLUSTER.opsUrl
    });
  }
});

app.get("/api/toml/xahau", (_req, res) => {
  try {
    res.type("text/plain; charset=utf-8").send(fs.readFileSync(xahauTomlPath, "utf8"));
  } catch (error) {
    res.status(500).json({ error: error.message || "Unable to read TOML file" });
  }
});

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

app.get("/onexah.png", (_req, res) => {
  res.sendFile(path.join(rootDir, "onexah.png"));
});

app.get("/xahau-logo.png", (_req, res) => {
  res.sendFile(path.join(rootDir, "xahau-logo.png"));
});

app.get("/cluster", (_req, res) => {
  res.sendFile(path.join(rootDir, "cluster.html"));
});

app.get("/cluster.html", (_req, res) => {
  res.sendFile(path.join(rootDir, "cluster.html"));
});

app.get("/cluster.js", (_req, res) => {
  res.sendFile(path.join(rootDir, "cluster.js"));
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(rootDir, "admin.html"));
});

app.get("/admin.html", (_req, res) => {
  res.sendFile(path.join(rootDir, "admin.html"));
});

app.get("/admin.js", (_req, res) => {
  res.sendFile(path.join(rootDir, "admin.js"));
});

app.use("/media", express.static(path.join(rootDir, "media")));
app.use("/.well-known", express.static(path.join(rootDir, ".well-known")));

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Cbot Labs listening on http://localhost:${port}`);
});
