const { DatabaseSync } = require('node:sqlite');

const EXTRA_COLUMNS = { slots: 'INTEGER' };
const REMOVED_COLUMNS = ['dust83', 'dust83q20', 'dust85', 'dust85q20', 'type', 'subtype'];

function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      name       TEXT PRIMARY KEY,
      dust84     INTEGER,
      dust84q20  INTEGER,
      slots      INTEGER
    )
  `);
  const columns = db.prepare('PRAGMA table_info(items)').all().map(c => c.name);
  for (const [colName, sqlType] of Object.entries(EXTRA_COLUMNS)) {
    if (!columns.includes(colName)) {
      db.exec(`ALTER TABLE items ADD COLUMN ${colName} ${sqlType}`);
    }
  }
  for (const colName of REMOVED_COLUMNS) {
    if (columns.includes(colName)) {
      db.exec(`ALTER TABLE items DROP COLUMN ${colName}`);
    }
  }
  return db;
}

function getAllItems(db) {
  return db.prepare('SELECT * FROM items ORDER BY name').all();
}

function insertItem(db, item) {
  const stmt = db.prepare(`
    INSERT INTO items (name, dust84, dust84q20, slots)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      dust84 = excluded.dust84, dust84q20 = excluded.dust84q20, slots = excluded.slots
  `);
  stmt.run(
    item.name,
    item.dust84 ?? null, item.dust84q20 ?? null, item.slots ?? null
  );
}

module.exports = { openDb, getAllItems, insertItem };
