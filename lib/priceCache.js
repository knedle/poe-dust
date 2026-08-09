const fs = require('node:fs');
const path = require('node:path');

function cachePath(cacheDir, league) {
  return path.join(cacheDir, league.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
}

function readCache(cacheDir, league) {
  const file = cachePath(cacheDir, league);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeCache(cacheDir, league, payload) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePath(cacheDir, league), JSON.stringify(payload));
}

function isFresh(timestamp, ttlMs) {
  return typeof timestamp === 'number' && (Date.now() - timestamp) < ttlMs;
}

module.exports = { cachePath, readCache, writeCache, isFresh };
