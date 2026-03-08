'use strict';

// Lightweight server bootstrap for owner-only admin routes.
// If your project already has a server.js, this file integrates the admin routes
// and preserves strong owner-only auth via OWNER_WALLETS env var.

const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Basic JSON middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the admin-projects statically under /admin-projects
app.use('/admin-projects', express.static(path.join(__dirname, 'admin-projects')));

// Mount admin trading routes
try {
  const adminTrading = require('./routes/admin/trading');
  app.use(adminTrading);
} catch (err) {
  console.error('Failed to mount admin trading routes:', err && err.stack ? err.stack : err);
}

// Basic root info
app.get('/', (req, res) => {
  res.json({ ok: true, msg: 'Cbot Labs Admin API', env: process.env.NODE_ENV || 'development' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
