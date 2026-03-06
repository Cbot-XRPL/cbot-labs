const express = require("express");
const os = require("os");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const rootDir = __dirname;
const wellKnownDir = path.join(rootDir, ".well-known");

const appData = {
  brand: {
    name: "Cbot Labs",
    tagline: "Xahau builder node",
    summary: "A local-first app shell for validator identity, tools, and future Xahau automation.",
    logo: "/ll.png"
  },
  validator: {
    publicKey: "nHUCQgftpGqfDAY7XMCXPbyBBvGRg9T6n1YMnmaG2trnrYeywAjL",
    account: "rCboTXmnomVJzRKVXqDMDFzwTaCKFAcYs",
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
      href: "mailto:cody@cbotlabs.xyz",
      icon: "envelope"
    },
    {
      label: "Twitter",
      href: "https://twitter.com/Cbot_Xrpl",
      icon: "twitter"
    },
    {
      label: "GitHub",
      href: "https://github.com/Cbot-XRPL",
      icon: "github"
    }
  ],
  modules: [
    {
      name: "Identity",
      description: "Domain metadata, validator details, and account references served from one backend.",
      status: "ready"
    },
    {
      name: "API Layer",
      description: "Express routes that the frontend can consume without hardcoded content.",
      status: "ready"
    },
    {
      name: "Automation",
      description: "Reserved space for jobs, monitoring, and validator tooling as the app expands.",
      status: "planned"
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

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    app: appData.brand.name,
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/app", (req, res) => {
  res.json(appData);
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

app.use("/.well-known", express.static(wellKnownDir));
app.use(express.static(rootDir));

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
