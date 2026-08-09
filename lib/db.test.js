const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDb, getAllItems, insertItem, updateItem } = require('./db');

test('openDb creates the items table; getAllItems starts empty', () => {
  const db = openDb(':memory:');
  assert.deepStrictEqual(getAllItems(db), []);
  db.close();
});

test('insertItem inserts a row retrievable by getAllItems, with unset columns null', () => {
  const db = openDb(':memory:');
  insertItem(db, { name: 'Original Sin', dust84: 2257780, dust84q20: 2709336 });
  const rows = getAllItems(db);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Original Sin');
  assert.strictEqual(rows[0].dust84, 2257780);
  assert.strictEqual(rows[0].dust84q20, 2709336);
  assert.strictEqual(rows[0].dust83, null);
  assert.strictEqual(rows[0].dust85q20, null);
  db.close();
});

test('insertItem stores slots, type, and subtype, retrievable via getAllItems', () => {
  const db = openDb(':memory:');
  insertItem(db, { name: 'Headhunter', dust84: 1, slots: 2, type: 'Jewellery', subtype: 'Leather Belt' });
  const rows = getAllItems(db);
  assert.strictEqual(rows[0].slots, 2);
  assert.strictEqual(rows[0].type, 'Jewellery');
  assert.strictEqual(rows[0].subtype, 'Leather Belt');
  db.close();
});

test('openDb migrates an existing database file that predates slots/type/subtype', () => {
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
      dust85q20  INTEGER
    )
  `);
  oldDb.prepare('INSERT INTO items (name, dust84) VALUES (?, ?)').run('Foo', 1);
  oldDb.close();

  const migrated = openDb(dbPath);
  const rows = getAllItems(migrated);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Foo');
  assert.strictEqual(rows[0].dust84, 1);
  assert.strictEqual(rows[0].slots, null);
  assert.strictEqual(rows[0].type, null);
  assert.strictEqual(rows[0].subtype, null);
  migrated.close();

  fs.rmSync(dir, { recursive: true, force: true });
});

test('updateItem accepts slots, type, and subtype as settable fields', () => {
  const db = openDb(':memory:');
  insertItem(db, { name: 'Foo', dust84: 1, slots: 4 });
  const changed = updateItem(db, 'Foo', { slots: 8, type: 'Weapon', subtype: 'Vaal Hatchet' });
  assert.strictEqual(changed, 1);
  const row = getAllItems(db)[0];
  assert.strictEqual(row.slots, 8);
  assert.strictEqual(row.type, 'Weapon');
  assert.strictEqual(row.subtype, 'Vaal Hatchet');
  db.close();
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

test('updateItem updates only the given columns and reports affected rows', () => {
  const db = openDb(':memory:');
  insertItem(db, { name: 'Foo', dust84: 1 });
  const changed = updateItem(db, 'Foo', { dust83: 5 });
  assert.strictEqual(changed, 1);
  const row = getAllItems(db)[0];
  assert.strictEqual(row.dust83, 5);
  assert.strictEqual(row.dust84, 1);
  db.close();
});

test('updateItem returns 0 for a nonexistent item', () => {
  const db = openDb(':memory:');
  const changed = updateItem(db, 'DoesNotExist', { dust83: 5 });
  assert.strictEqual(changed, 0);
  db.close();
});

test('updateItem ignores unknown fields and no-ops if nothing valid is given', () => {
  const db = openDb(':memory:');
  insertItem(db, { name: 'Foo', dust84: 1 });
  const changed = updateItem(db, 'Foo', { notAColumn: 99 });
  assert.strictEqual(changed, 0);
  db.close();
});
