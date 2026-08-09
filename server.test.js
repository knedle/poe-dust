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
  await withServer({ dbConn, cacheDir }, async (base) => {
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
  await withServer({ dbConn, cacheDir }, async (base) => {
    const res = await fetch(`${base}/api/cache-status`);
    assert.strictEqual(res.status, 400);
  });
  dbConn.close();
});

test('GET /api/cache-status with no cached file reports not fresh', async () => {
  const dbConn = setupDb();
  const cacheDir = tempDir('poe-dust-cache-');
  await withServer({ dbConn, cacheDir }, async (base) => {
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
  await withServer({ dbConn, cacheDir, fetchAllPrices }, async (base) => {
    const first = await (await fetch(`${base}/api/prices?league=Mirage`)).json();
    assert.strictEqual(first.fromCache, false);
    assert.strictEqual(calls, 1);

    const second = await (await fetch(`${base}/api/prices?league=Mirage`)).json();
    assert.strictEqual(second.fromCache, true);
    assert.strictEqual(calls, 1);
  });
  dbConn.close();
});

test('static files are served from staticDir, defaulting / to index.html', async () => {
  const dbConn = setupDb();
  const cacheDir = tempDir('poe-dust-cache-');
  const staticDir = tempDir('poe-dust-static-');
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<html>ok</html>');
  await withServer({ dbConn, cacheDir, staticDir }, async (base) => {
    const res = await fetch(`${base}/`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), '<html>ok</html>');
    const notFound = await fetch(`${base}/nope.html`);
    assert.strictEqual(notFound.status, 404);
  });
  dbConn.close();
});
