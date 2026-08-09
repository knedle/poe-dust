const { test } = require('node:test');
const assert = require('node:assert');
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
