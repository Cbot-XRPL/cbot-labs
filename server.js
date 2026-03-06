const express = require("express");
const os = require("os");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const rootDir = __dirname;
const wellKnownDir = path.join(rootDir, ".well-known");

app.use((req, res, next) => {
  if (req.path.endsWith(".toml")) {
    res.type("application/toml");
    res.set("Access-Control-Allow-Origin", "*");
  }
  next();
});

app.use(express.static(rootDir));
app.use("/.well-known", express.static(wellKnownDir));

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
