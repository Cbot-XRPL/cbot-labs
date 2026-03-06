const express = require("express");
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

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Cbot Labs server listening on http://localhost:${port}`);
  });
}

module.exports = app;
