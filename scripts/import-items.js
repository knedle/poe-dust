const fs = require('node:fs');
const path = require('node:path');
const { openDb, insertItem } = require('../lib/db');

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function parseSeedCsv(csvText) {
  const lines = csvText.trim().split('\n');
  const header = parseCsvLine(lines[0]);
  const nameIdx = header.indexOf('name');
  const dust84Idx = header.indexOf('dustValIlvl84');
  const dust84q20Idx = header.indexOf('dustValIlvl84Q20');
  const items = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = parseCsvLine(lines[i]);
    const name = fields[nameIdx];
    if (!name) continue;
    items.push({
      name,
      dust84: Math.round(parseFloat(fields[dust84Idx])),
      dust84q20: Math.round(parseFloat(fields[dust84q20Idx])),
    });
  }
  return items;
}

function run(csvPath, dbPath) {
  const csvText = fs.readFileSync(csvPath, 'utf8');
  const items = parseSeedCsv(csvText);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDb(dbPath);
  for (const item of items) insertItem(db, item);
  db.close();
  return items.length;
}

module.exports = { parseCsvLine, parseSeedCsv, run };

if (require.main === module) {
  const csvPath = path.join(__dirname, 'seed.csv');
  const dbPath = path.join(__dirname, '..', 'data', 'poe-dust.db');
  const count = run(csvPath, dbPath);
  console.log(`Imported ${count} items into ${dbPath}`);
}
