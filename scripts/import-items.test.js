const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCsvLine, parseSeedCsv, run } = require('./import-items');
const { openDb, getAllItems } = require('../lib/db');

const FIXTURE_CSV = [
  'name,baseType,dustVal,dustValIlvl84,dustValIlvl84Q20,dustPerSlot,w,h,slots,link',
  'Original Sin,Amethyst Ring,1128.890000,2257780,2709336,2257780,1,1,1,https://poedb.tw/us/Original_Sin',
  '"Jack, the Axe",Vaal Hatchet,13.260000,26520,31824,4420,2,3,6,https://poedb.tw/us/Jack%2C_the_Axe',
].join('\n');

test('parseCsvLine splits on commas outside of double-quoted fields', () => {
  assert.deepStrictEqual(
    parseCsvLine('"Jack, the Axe",Vaal Hatchet,26520'),
    ['Jack, the Axe', 'Vaal Hatchet', '26520']
  );
  assert.deepStrictEqual(
    parseCsvLine('Original Sin,Amethyst Ring,2257780'),
    ['Original Sin', 'Amethyst Ring', '2257780']
  );
});

test('parseSeedCsv extracts name, dust84, dust84q20, and slots from every row', () => {
  const items = parseSeedCsv(FIXTURE_CSV);
  assert.deepStrictEqual(items, [
    { name: 'Original Sin', dust84: 2257780, dust84q20: 2709336, slots: 1 },
    { name: 'Jack, the Axe', dust84: 26520, dust84q20: 31824, slots: 6 },
  ]);
});

test('run imports the CSV into a fresh SQLite file with dust83/85 left null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poe-dust-import-test-'));
  const csvPath = path.join(dir, 'seed.csv');
  const dbPath = path.join(dir, 'poe-dust.db');
  fs.writeFileSync(csvPath, FIXTURE_CSV);

  const count = run(csvPath, dbPath);
  assert.strictEqual(count, 2);

  const db = openDb(dbPath);
  const rows = getAllItems(db);
  db.close();
  assert.strictEqual(rows.length, 2);
  const originalSin = rows.find(r => r.name === 'Original Sin');
  assert.strictEqual(originalSin.dust84, 2257780);
  assert.strictEqual(originalSin.dust84q20, 2709336);
  assert.strictEqual(originalSin.dust83, null);
  assert.strictEqual(originalSin.dust85, null);
  assert.strictEqual(originalSin.slots, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseSeedCsv sets slots to null when the column is missing or unparseable', () => {
  const csvNoSlotsColumn = [
    'name,dustValIlvl84,dustValIlvl84Q20',
    'Foo,100,120',
  ].join('\n');
  assert.deepStrictEqual(parseSeedCsv(csvNoSlotsColumn), [
    { name: 'Foo', dust84: 100, dust84q20: 120, slots: null },
  ]);

  const csvBlankSlots = [
    'name,dustValIlvl84,dustValIlvl84Q20,slots',
    'Foo,100,120,',
  ].join('\n');
  assert.deepStrictEqual(parseSeedCsv(csvBlankSlots), [
    { name: 'Foo', dust84: 100, dust84q20: 120, slots: null },
  ]);
});
