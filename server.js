const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const db = require('./lib/db');
const auth = require('./lib/auth');
const priceCache = require('./lib/priceCache');
const poeNinja = require('./lib/poeNinja');

const CACHE_TTL = 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function getSessionToken(req) {
  // A malformed percent-encoded Cookie header (e.g. `session=%E0%A4%A`) makes
  // auth.parseCookies's decodeURIComponent throw synchronously. Since this is
  // called directly from request handlers (not inside a Promise chain), an
  // uncaught throw here would crash the whole process, not just this request.
  // Degrade to "no session" instead.
  try {
    return auth.parseCookies(req.headers.cookie).session;
  } catch (e) {
    return undefined;
  }
}

function resolveStaticPath(staticDir, pathname) {
  const safePathname = pathname === '/' ? '/index.html' : pathname;
  const resolvedStaticDir = path.resolve(staticDir);
  const resolvedFilePath = path.resolve(path.join(staticDir, safePathname));
  if (resolvedFilePath !== resolvedStaticDir && !resolvedFilePath.startsWith(resolvedStaticDir + path.sep)) {
    return null;
  }
  return resolvedFilePath;
}

function createServer({
  dbConn,
  cacheDir,
  staticDir = __dirname,
  fetchLeagues = poeNinja.fetchLeagues,
  fetchAllPrices = poeNinja.fetchAllPrices,
  adminPassword = process.env.ADMIN_PASSWORD,
} = {}) {
  return http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    if (pathname === '/api/leagues' && req.method === 'GET') {
      fetchLeagues()
        .then(data => sendJson(res, 200, data))
        .catch(e => sendJson(res, 502, { error: e.message }));
      return;
    }

    if (pathname === '/api/cache-status' && req.method === 'GET') {
      const league = parsedUrl.query.league;
      if (!league) return sendJson(res, 400, { error: 'missing league' });
      const cached = priceCache.readCache(cacheDir, league);
      if (!cached) return sendJson(res, 200, { timestamp: null, fresh: false });
      return sendJson(res, 200, { timestamp: cached.timestamp, fresh: priceCache.isFresh(cached.timestamp, CACHE_TTL) });
    }

    if (pathname === '/api/prices' && req.method === 'GET') {
      const league = parsedUrl.query.league;
      if (!league) return sendJson(res, 400, { error: 'missing league' });
      const cached = priceCache.readCache(cacheDir, league);
      if (cached && priceCache.isFresh(cached.timestamp, CACHE_TTL)) {
        return sendJson(res, 200, { ...cached, fromCache: true });
      }
      fetchAllPrices(league)
        .then(({ items, errors }) => {
          const payload = { timestamp: Date.now(), items, errors };
          priceCache.writeCache(cacheDir, league, payload);
          sendJson(res, 200, { ...payload, fromCache: false });
        })
        .catch(e => sendJson(res, 500, { error: e.message }));
      return;
    }

    if (pathname === '/api/items' && req.method === 'GET') {
      return sendJson(res, 200, db.getAllItems(dbConn));
    }

    if (pathname === '/api/admin/session' && req.method === 'GET') {
      return sendJson(res, 200, { authenticated: auth.isValidSession(getSessionToken(req)) });
    }

    if (pathname === '/api/admin/login' && req.method === 'POST') {
      readJsonBody(req)
        .then(body => {
          const token = auth.login(body.password, adminPassword);
          if (!token) return sendJson(res, 401, { error: 'invalid password' });
          res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(auth.SESSION_TTL_MS / 1000)}`);
          sendJson(res, 200, { ok: true });
        })
        .catch(e => sendJson(res, 400, { error: e.message }));
      return;
    }

    if (pathname === '/api/admin/logout' && req.method === 'POST') {
      auth.logout(getSessionToken(req));
      res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
      return sendJson(res, 200, { ok: true });
    }

    const itemMatch = pathname.match(/^\/api\/admin\/items\/(.+)$/);
    if (itemMatch && req.method === 'PUT') {
      if (!auth.isValidSession(getSessionToken(req))) return sendJson(res, 401, { error: 'not authenticated' });
      let name;
      try {
        name = decodeURIComponent(itemMatch[1]);
      } catch (e) {
        return sendJson(res, 400, { error: 'invalid item name' });
      }
      readJsonBody(req)
        .then(body => {
          const changed = db.updateItem(dbConn, name, body);
          if (changed === 0) return sendJson(res, 404, { error: 'item not found' });
          sendJson(res, 200, { ok: true });
        })
        .catch(e => sendJson(res, 400, { error: e.message }));
      return;
    }

    const filePath = resolveStaticPath(staticDir, pathname);
    if (!filePath) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

module.exports = { createServer, resolveStaticPath };

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  const dataDir = path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = process.env.POE_DUST_DB_PATH || path.join(dataDir, 'poe-dust.db');
  const dbConn = db.openDb(dbPath);
  const cacheDir = path.join(__dirname, 'cache');
  const server = createServer({ dbConn, cacheDir });
  server.listen(PORT, () => {
    console.log(`poe-dust running on http://localhost:${PORT}`);
  });
}
