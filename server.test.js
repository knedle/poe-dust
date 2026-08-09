const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer, resolveStaticPath } = require('./server');
const db = require('./lib/db');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withServer(opts, fn) {
  return new Promise((resolve, reject) => {
    const server = createServer(opts);
    server.listen(0, async () => {
      const base = `http://localhost:${server.address().port}`;
      try {
        await fn(base);
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

function setupDb() {
  const dbConn = db.openDb(':memory:');
  db.insertItem(dbConn, { name: 'Original Sin', dust84: 2257780, dust84q20: 2709336 });
  return dbConn;
}

test('resolveStaticPath refuses to escape staticDir via ../ segments', () => {
  assert.strictEqual(resolveStaticPath('/app', '/../../../../etc/passwd'), null);
  assert.ok(resolveStaticPath('/app', '/index.html'));
  assert.ok(resolveStaticPath('/app', '/'));
});

test('GET /api/items returns all rows from the database', async () => {
  const dbConn = setupDb();
  const cacheDir = tempDir('poe-dust-cache-');
  await withServer({ dbConn, cacheDir, adminPassword: 'secret' }, async (base) => {
    const res = await fetch(`${base}/api/items`);
    assert.strictEqual(res.status, 200);
    const items = await res.json();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, 'Original Sin');
  });
  dbConn.close();
});

test('GET /api/cache-status without a league returns 400', async () => {
  const dbConn = setupDb();
  const cacheDir = tempDir('poe-dust-cache-');
  await withServer({ dbConn, cacheDir, adminPassword: 'secret' }, async (base) => {
    const res = await fetch(`${base}/api/cache-status`);
    assert.strictEqual(res.status, 400);
  });
  dbConn.close();
});

test('GET /api/cache-status with no cached file reports not fresh', async () => {
  const dbConn = setupDb();
  const cacheDir = tempDir('poe-dust-cache-');
  await withServer({ dbConn, cacheDir, adminPassword: 'secret' }, async (base) => {
    const res = await fetch(`${base}/api/cache-status?league=Mirage`);
    assert.deepStrictEqual(await res.json(), { timestamp: null, fresh: false });
  });
  dbConn.close();
});

test('GET /api/prices fetches once then serves from cache on the next call', async () => {
  const dbConn = setupDb();
  const cacheDir = tempDir('poe-dust-cache-');
  let calls = 0;
  const fetchAllPrices = async () => {
    calls++;
    return { items: [{ name: 'Original Sin', chaosValue: 5, _category: 'UniqueAccessory' }], errors: [] };
  };
  await withServer({ dbConn, cacheDir, adminPassword: 'secret', fetchAllPrices }, async (base) => {
    const first = await (await fetch(`${base}/api/prices?league=Mirage`)).json();
    assert.strictEqual(first.fromCache, false);
    assert.strictEqual(calls, 1);

    const second = await (await fetch(`${base}/api/prices?league=Mirage`)).json();
    assert.strictEqual(second.fromCache, true);
    assert.strictEqual(calls, 1);
  });
  dbConn.close();
});

test('admin login rejects a wrong password and accepts the right one with a session cookie', async () => {
  const dbConn = setupDb();
  const cacheDir = tempDir('poe-dust-cache-');
  await withServer({ dbConn, cacheDir, adminPassword: 'secret' }, async (base) => {
    const bad = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    assert.strictEqual(bad.status, 401);

    const good = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret' }),
    });
    assert.strictEqual(good.status, 200);
    assert.ok(good.headers.get('set-cookie').startsWith('session='));
  });
  dbConn.close();
});

test('PUT /api/admin/items/:name requires an authenticated session', async () => {
  const dbConn = setupDb();
  const cacheDir = tempDir('poe-dust-cache-');
  await withServer({ dbConn, cacheDir, adminPassword: 'secret' }, async (base) => {
    const res = await fetch(`${base}/api/admin/items/${encodeURIComponent('Original Sin')}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dust83: 100 }),
    });
    assert.strictEqual(res.status, 401);
  });
  dbConn.close();
});

test('PUT /api/admin/items/:name updates a row when authenticated, 404s for an unknown item', async () => {
  const dbConn = setupDb();
  const cacheDir = tempDir('poe-dust-cache-');
  await withServer({ dbConn, cacheDir, adminPassword: 'secret' }, async (base) => {
    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret' }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const ok = await fetch(`${base}/api/admin/items/${encodeURIComponent('Original Sin')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ dust83: 100 }),
    });
    assert.strictEqual(ok.status, 200);

    const items = await (await fetch(`${base}/api/items`)).json();
    assert.strictEqual(items[0].dust83, 100);

    const missing = await fetch(`${base}/api/admin/items/${encodeURIComponent('Nope')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ dust83: 1 }),
    });
    assert.strictEqual(missing.status, 404);
  });
  dbConn.close();
});

test('GET /api/admin/session reflects login state, and logout clears it', async () => {
  const dbConn = setupDb();
  const cacheDir = tempDir('poe-dust-cache-');
  await withServer({ dbConn, cacheDir, adminPassword: 'secret' }, async (base) => {
    const before = await (await fetch(`${base}/api/admin/session`)).json();
    assert.strictEqual(before.authenticated, false);

    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret' }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const after = await (await fetch(`${base}/api/admin/session`, { headers: { Cookie: cookie } })).json();
    assert.strictEqual(after.authenticated, true);

    await fetch(`${base}/api/admin/logout`, { method: 'POST', headers: { Cookie: cookie } });
    const afterLogout = await (await fetch(`${base}/api/admin/session`, { headers: { Cookie: cookie } })).json();
    assert.strictEqual(afterLogout.authenticated, false);
  });
  dbConn.close();
});

test('static files are served from staticDir, defaulting / to index.html', async () => {
  const dbConn = setupDb();
  const cacheDir = tempDir('poe-dust-cache-');
  const staticDir = tempDir('poe-dust-static-');
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<html>ok</html>');
  await withServer({ dbConn, cacheDir, adminPassword: 'secret', staticDir }, async (base) => {
    const res = await fetch(`${base}/`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), '<html>ok</html>');
    const notFound = await fetch(`${base}/nope.html`);
    assert.strictEqual(notFound.status, 404);
  });
  dbConn.close();
});

test('a malformed percent-encoded Cookie header degrades to "no session" instead of crashing the server', async () => {
  const dbConn = setupDb();
  const cacheDir = tempDir('poe-dust-cache-');
  await withServer({ dbConn, cacheDir, adminPassword: 'secret' }, async (base) => {
    const res = await fetch(`${base}/api/admin/session`, {
      headers: { Cookie: 'session=%E0%A4%A' },
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { authenticated: false });
  });
  dbConn.close();
});
