const { DatabaseSync } = require('node:sqlite');

const DUST_COLUMNS = ['dust84', 'dust84q20'];
const EXTRA_COLUMNS = { slots: 'INTEGER', type: 'TEXT', subtype: 'TEXT' };
const EDITABLE_COLUMNS = [...DUST_COLUMNS, ...Object.keys(EXTRA_COLUMNS)];
const REMOVED_COLUMNS = ['dust83', 'dust83q20', 'dust85', 'dust85q20'];

function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      name       TEXT PRIMARY KEY,
      dust84     INTEGER,
      dust84q20  INTEGER,
      slots      INTEGER,
      type       TEXT,
      subtype    TEXT
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
    INSERT INTO items (name, dust84, dust84q20, slots, type, subtype)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      dust84 = excluded.dust84, dust84q20 = excluded.dust84q20,
      slots = excluded.slots, type = excluded.type, subtype = excluded.subtype
  `);
  stmt.run(
    item.name,
    item.dust84 ?? null, item.dust84q20 ?? null,
    item.slots ?? null, item.type ?? null, item.subtype ?? null
  );
}

function updateItem(db, name, fields) {
  const setCols = Object.keys(fields).filter(k => EDITABLE_COLUMNS.includes(k));
  if (setCols.length === 0) return 0;
  const setClause = setCols.map(c => `${c} = ?`).join(', ');
  const stmt = db.prepare(`UPDATE items SET ${setClause} WHERE name = ?`);
  const result = stmt.run(...setCols.map(c => fields[c]), name);
  return result.changes;
}

module.exports = { DUST_COLUMNS, EDITABLE_COLUMNS, openDb, getAllItems, insertItem, updateItem };
