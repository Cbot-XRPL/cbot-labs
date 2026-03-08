'use strict';

const fs = require('fs');
const path = require('path');

const STRAT_PATH = path.join(__dirname, '..', 'admin-projects', 'xrpl-trading-bot', 'strategies.json');

// Note: this module is intentionally read-only. It exposes strategy definitions for
// server-side monitoring, dashboards, or controlled execution layers. It does not
// perform any signing or XRPL network operations.

function getStrategies(){
  try{
    const raw = fs.readFileSync(STRAT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch(e){
    // Return empty list on error and let caller handle logging
    return [];
  }
}

function findStrategy(id){
  const all = getStrategies();
  return all.find(s => s.id === id);
}

module.exports = {
  getStrategies,
  findStrategy,
  // Lightweight simulation helpers could be added here for server-side simulation
};
