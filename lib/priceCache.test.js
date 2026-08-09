const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cachePath, readCache, writeCache, isFresh } = require('./priceCache');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'poe-dust-cache-test-'));
}

test('writeCache then readCache round-trips the payload', () => {
  const dir = tempDir();
  writeCache(dir, 'Mirage', { timestamp: 123, items: [], errors: [] });
  assert.deepStrictEqual(readCache(dir, 'Mirage'), { timestamp: 123, items: [], errors: [] });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readCache returns null when no cache file exists', () => {
  const dir = tempDir();
  assert.strictEqual(readCache(dir, 'Nope'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readCache returns null for a corrupt cache file instead of throwing', () => {
  const dir = tempDir();
  fs.writeFileSync(cachePath(dir, 'Broken'), 'not json');
  assert.strictEqual(readCache(dir, 'Broken'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeCache creates cacheDir if it does not exist yet', () => {
  const parent = tempDir();
  const dir = path.join(parent, 'nested');
  writeCache(dir, 'Mirage', { timestamp: 1, items: [], errors: [] });
  assert.ok(fs.existsSync(cachePath(dir, 'Mirage')));
  fs.rmSync(parent, { recursive: true, force: true });
});

test('cachePath sanitizes league names that contain filesystem-unsafe characters', () => {
  const p = cachePath('/tmp/cache', 'My/League:Name');
  assert.strictEqual(path.basename(p), 'My_League_Name.json');
});

test('isFresh is true within the TTL and false once it elapses or timestamp is missing', () => {
  assert.strictEqual(isFresh(Date.now(), 60000), true);
  assert.strictEqual(isFresh(Date.now() - 120000, 60000), false);
  assert.strictEqual(isFresh(undefined, 60000), false);
  assert.strictEqual(isFresh(null, 60000), false);
});
