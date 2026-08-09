const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDb, getAllItems, insertItem } = require('./db');

test('openDb creates the items table; getAllItems starts empty', () => {
  const db = openDb(':memory:');
  assert.deepStrictEqual(getAllItems(db), []);
  db.close();
});

test('insertItem inserts a row retrievable by getAllItems, with unset columns null', () => {
  const db = openDb(':memory:');
  insertItem(db, { name: 'Original Sin', dust84: 2822225, dust84q20: 3951115 });
  const rows = getAllItems(db);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Original Sin');
  assert.strictEqual(rows[0].dust84, 2822225);
  assert.strictEqual(rows[0].dust84q20, 3951115);
  assert.strictEqual(rows[0].slots, null);
  db.close();
});

test('insertItem stores slots, retrievable via getAllItems', () => {
  const db = openDb(':memory:');
  insertItem(db, { name: 'Headhunter', dust84: 1, slots: 2 });
  const rows = getAllItems(db);
  assert.strictEqual(rows[0].slots, 2);
  db.close();
});

test('openDb migrates an old database: adds slots, drops dust83/dust85/type/subtype', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poe-dust-db-test-'));
  const dbPath = path.join(dir, 'old.db');

  const oldDb = new DatabaseSync(dbPath);
  oldDb.exec(`
    CREATE TABLE items (
      name       TEXT PRIMARY KEY,
      dust83     INTEGER,
      dust83q20  INTEGER,
      dust84     INTEGER,
      dust84q20  INTEGER,
      dust85     INTEGER,
      dust85q20  INTEGER,
      type       TEXT,
      subtype    TEXT
    )
  `);
  oldDb.prepare('INSERT INTO items (name, dust84, dust83, type) VALUES (?, ?, ?, ?)').run('Foo', 1, 99, 'Weapon');
  oldDb.close();

  const migrated = openDb(dbPath);
  const rows = getAllItems(migrated);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Foo');
  assert.strictEqual(rows[0].dust84, 1);
  assert.strictEqual(rows[0].slots, null);
  assert.strictEqual(rows[0].dust83, undefined);
  assert.strictEqual(rows[0].type, undefined);
  assert.strictEqual(rows[0].subtype, undefined);
  const columns = migrated.prepare('PRAGMA table_info(items)').all().map(c => c.name);
  assert.deepStrictEqual(columns.sort(), ['dust84', 'dust84q20', 'name', 'slots']);
  migrated.close();

  fs.rmSync(dir, { recursive: true, force: true });
});

test('insertItem upserts when called twice with the same name', () => {
  const db = openDb(':memory:');
  insertItem(db, { name: 'Foo', dust84: 1 });
  insertItem(db, { name: 'Foo', dust84: 2 });
  const rows = getAllItems(db);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].dust84, 2);
  db.close();
});

test('getAllItems returns rows sorted by name', () => {
  const db = openDb(':memory:');
  insertItem(db, { name: 'Zeta' });
  insertItem(db, { name: 'Alpha' });
  const rows = getAllItems(db);
  assert.deepStrictEqual(rows.map(r => r.name), ['Alpha', 'Zeta']);
  db.close();
});
