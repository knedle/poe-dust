# poe-dust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build poe-dust, a zero-dependency Node.js web app that lists Path of Exile unique items with their disenchant "dust" yield at item levels 83/84/85 (base and +20% quality), their current chaos price from poe.ninja, and a dust-per-chaos efficiency ratio, with admin-editable dust data stored in SQLite.

**Architecture:** A single `http` server (`server.js`) composed from small single-purpose modules (`lib/db.js`, `lib/auth.js`, `lib/priceCache.js`, `lib/poeNinja.js`) serving one self-contained `index.html` (inline CSS/JS, no build step). Modeled directly on `E:\docker\heist` for styling, endpoint conventions, and the poe.ninja fetch/cache pattern; diverges where poe-dust's requirements differ (SQLite persistence, a sortable table UI instead of cards, password-gated inline editing).

**Tech Stack:** Node.js 22 (built-ins only: `node:http`, `node:https`, `node:fs`, `node:path`, `node:url`, `node:crypto`, `node:sqlite`), Node's built-in test runner (`node:test` + `node:assert`), Docker / Docker Compose, no npm dependencies.

## Global Constraints

- Zero runtime dependencies: Node.js built-ins only, no `npm install`, no `node_modules`. Verified locally that `node:sqlite`'s `DatabaseSync` works unflagged (no `--experimental-sqlite` needed) on the `node:22-alpine` image this project targets (tested: `docker run --rm node:22-alpine` reports `v22.22.2` and successfully runs a `CREATE TABLE`/insert/select round-trip).
- Reference project for conventions: `E:\docker\heist` — reuse its color palette, header/controls layout, poe.ninja `fetchJson` redirect-following logic, 1-hour cache TTL constant, and league-auto-detect logic verbatim where the spec doesn't require a change.
- poe.ninja categories: `UniqueWeapon`, `UniqueArmour`, `UniqueAccessory` only. `UniqueJewel` is excluded (spec: jewels aren't part of the dust mechanic).
- An item's displayed price is the **minimum** `chaosValue` across all poe.ninja listings for that name (link-count variants are irrelevant to dust yield).
- An item from the database with no matching name in the current league's poe.ninja data is omitted from the table entirely (no manual type tagging, no dead rows).
- The `dust<ilvl>q20` / `dust<ilvl>` columns are independently admin-editable `INTEGER` columns; a `NULL` renders as `—` and is excluded from that level's efficiency calculation.
- **Interpretation to confirm with the user:** the spec's third per-level column ("přepočet na 1 chaos") is implemented here as `dust<ilvl>q20 / chaosValue` (dust yield at 20% quality per chaos spent) — the spec text didn't pin down whether the base or +20 dust value feeds that ratio; this plan picks the +20 value since that reflects the item as a player would actually farm it. Flag this to the user after implementation if a different formula was intended.
- Admin auth: single shared password from the `ADMIN_PASSWORD` env var, in-memory `Map<token, expiresAt>` session store (24h TTL), `HttpOnly` cookie named `session`. No database-backed sessions, no multi-user accounts.
- Local Docker Compose port: `3001` (heist already uses `3000`).
- Production/Render persistence of `data/poe-dust.db` is explicitly out of scope for this plan.

---

## Task 1: SQLite data layer (`lib/db.js`)

**Files:**
- Create: `lib/db.js`
- Test: `lib/db.test.js`

**Interfaces:**
- Consumes: nothing (foundation module).
- Produces:
  - `DUST_COLUMNS: string[]` — `['dust83', 'dust83q20', 'dust84', 'dust84q20', 'dust85', 'dust85q20']`
  - `openDb(path: string): DatabaseSync` — opens (creating if needed) the SQLite file at `path` and ensures the `items` table exists. Pass `':memory:'` for an ephemeral in-memory DB (used by tests).
  - `getAllItems(db: DatabaseSync): object[]` — `SELECT * FROM items ORDER BY name`.
  - `insertItem(db: DatabaseSync, item: {name: string, dust83?, dust83q20?, dust84?, dust84q20?, dust85?, dust85q20?}): void` — upserts a row by `name`.
  - `updateItem(db: DatabaseSync, name: string, fields: object): number` — updates only the keys of `fields` that are valid dust columns; returns the number of rows changed (`0` if `name` doesn't exist or `fields` has no valid columns).

- [ ] **Step 1: Write the failing test**

Create `lib/db.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test lib/db.test.js`
Expected: FAIL — `Cannot find module './db'`

- [ ] **Step 3: Write the implementation**

Create `lib/db.js`:

```js
const { DatabaseSync } = require('node:sqlite');

const DUST_COLUMNS = ['dust83', 'dust83q20', 'dust84', 'dust84q20', 'dust85', 'dust85q20'];

function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      name       TEXT PRIMARY KEY,
      dust83     INTEGER,
      dust83q20  INTEGER,
      dust84     INTEGER,
      dust84q20  INTEGER,
      dust85     INTEGER,
      dust85q20  INTEGER
    )
  `);
  return db;
}

function getAllItems(db) {
  return db.prepare('SELECT * FROM items ORDER BY name').all();
}

function insertItem(db, item) {
  const stmt = db.prepare(`
    INSERT INTO items (name, dust83, dust83q20, dust84, dust84q20, dust85, dust85q20)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      dust83 = excluded.dust83, dust83q20 = excluded.dust83q20,
      dust84 = excluded.dust84, dust84q20 = excluded.dust84q20,
      dust85 = excluded.dust85, dust85q20 = excluded.dust85q20
  `);
  stmt.run(
    item.name,
    item.dust83 ?? null, item.dust83q20 ?? null,
    item.dust84 ?? null, item.dust84q20 ?? null,
    item.dust85 ?? null, item.dust85q20 ?? null
  );
}

function updateItem(db, name, fields) {
  const setCols = Object.keys(fields).filter(k => DUST_COLUMNS.includes(k));
  if (setCols.length === 0) return 0;
  const setClause = setCols.map(c => `${c} = ?`).join(', ');
  const stmt = db.prepare(`UPDATE items SET ${setClause} WHERE name = ?`);
  const result = stmt.run(...setCols.map(c => fields[c]), name);
  return result.changes;
}

module.exports = { DUST_COLUMNS, openDb, getAllItems, insertItem, updateItem };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test lib/db.test.js`
Expected: PASS, 7 tests passing (an `ExperimentalWarning: SQLite is an experimental feature` line is expected and not a failure).

- [ ] **Step 5: Commit**

```bash
git add lib/db.js lib/db.test.js
git commit -m "Add SQLite data layer for admin-edited dust values"
```

---

## Task 2: Admin session auth (`lib/auth.js`)

**Files:**
- Create: `lib/auth.js`
- Test: `lib/auth.test.js`

**Interfaces:**
- Consumes: nothing (foundation module).
- Produces:
  - `SESSION_TTL_MS: number` — `86400000` (24h).
  - `login(password: string, adminPassword: string, ttlMs = SESSION_TTL_MS): string | null` — returns a new session token on a correct password, `null` otherwise. `ttlMs` is overridable so tests can create already-expired sessions without sleeping.
  - `logout(token: string): void` — invalidates a session token (no-op if unknown).
  - `isValidSession(token: string | undefined): boolean` — `true` if `token` maps to a non-expired session.
  - `parseCookies(cookieHeader: string | undefined): Record<string, string>` — parses an HTTP `Cookie` request header into a plain object.

- [ ] **Step 1: Write the failing test**

Create `lib/auth.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { login, logout, isValidSession, parseCookies } = require('./auth');

test('login with the wrong password returns null', () => {
  assert.strictEqual(login('wrong', 'secret'), null);
});

test('login with the correct password returns a token accepted by isValidSession', () => {
  const token = login('secret', 'secret');
  assert.ok(typeof token === 'string' && token.length > 0);
  assert.strictEqual(isValidSession(token), true);
});

test('an expired session is invalid', () => {
  const token = login('secret', 'secret', -1);
  assert.strictEqual(isValidSession(token), false);
});

test('logout invalidates a session', () => {
  const token = login('secret', 'secret');
  logout(token);
  assert.strictEqual(isValidSession(token), false);
});

test('isValidSession rejects unknown or missing tokens', () => {
  assert.strictEqual(isValidSession('not-a-real-token'), false);
  assert.strictEqual(isValidSession(undefined), false);
});

test('logout on an unknown token does not throw', () => {
  assert.doesNotThrow(() => logout('not-a-real-token'));
});

test('parseCookies parses a multi-cookie header', () => {
  assert.deepStrictEqual(
    parseCookies('session=abc123; other=xyz'),
    { session: 'abc123', other: 'xyz' }
  );
});

test('parseCookies returns an empty object for a missing header', () => {
  assert.deepStrictEqual(parseCookies(undefined), {});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test lib/auth.test.js`
Expected: FAIL — `Cannot find module './auth'`

- [ ] **Step 3: Write the implementation**

Create `lib/auth.js`:

```js
const crypto = require('node:crypto');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();

function login(password, adminPassword, ttlMs = SESSION_TTL_MS) {
  if (!adminPassword || password !== adminPassword) return null;
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + ttlMs);
  return token;
}

function logout(token) {
  sessions.delete(token);
}

function isValidSession(token) {
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (expiresAt === undefined) return false;
  if (Date.now() > expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

module.exports = { SESSION_TTL_MS, login, logout, isValidSession, parseCookies };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test lib/auth.test.js`
Expected: PASS, 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.js lib/auth.test.js
git commit -m "Add shared-password admin session auth"
```

---

## Task 3: poe.ninja price file cache (`lib/priceCache.js`)

**Files:**
- Create: `lib/priceCache.js`
- Test: `lib/priceCache.test.js`

**Interfaces:**
- Consumes: nothing (foundation module).
- Produces:
  - `cachePath(cacheDir: string, league: string): string` — sanitizes `league` for filesystem safety and joins it with `cacheDir`.
  - `readCache(cacheDir: string, league: string): {timestamp: number, items: any[], errors: string[]} | null` — `null` if no cache file exists or it fails to parse.
  - `writeCache(cacheDir: string, league: string, payload: object): void` — creates `cacheDir` if needed and writes `payload` as JSON.
  - `isFresh(timestamp: number | null | undefined, ttlMs: number): boolean`.

- [ ] **Step 1: Write the failing test**

Create `lib/priceCache.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test lib/priceCache.test.js`
Expected: FAIL — `Cannot find module './priceCache'`

- [ ] **Step 3: Write the implementation**

Create `lib/priceCache.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

function cachePath(cacheDir, league) {
  return path.join(cacheDir, league.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
}

function readCache(cacheDir, league) {
  const file = cachePath(cacheDir, league);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeCache(cacheDir, league, payload) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePath(cacheDir, league), JSON.stringify(payload));
}

function isFresh(timestamp, ttlMs) {
  return typeof timestamp === 'number' && (Date.now() - timestamp) < ttlMs;
}

module.exports = { cachePath, readCache, writeCache, isFresh };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test lib/priceCache.test.js`
Expected: PASS, 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/priceCache.js lib/priceCache.test.js
git commit -m "Add file-based poe.ninja price cache with 1h TTL"
```

---

## Task 4: poe.ninja client (`lib/poeNinja.js`)

**Files:**
- Create: `lib/poeNinja.js`
- Test: `lib/poeNinja.test.js`

**Interfaces:**
- Consumes: nothing (foundation module; `server.js` will inject `fetchLeagues`/`fetchAllPrices` for testability).
- Produces:
  - `CATEGORIES: string[]` — `['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory']`.
  - `fetchJson(targetUrl: string, redirects?: number): Promise<any>` — GETs JSON over HTTPS, follows up to 5 redirects, rejects on invalid JSON or network error. Ported from heist's `server.js` `fetchJson`, unchanged.
  - `fetchLeagues(): Promise<any>` — proxies `https://www.pathofexile.com/api/trade/data/leagues`.
  - `fetchCategoryLines(league: string, category: string): Promise<object[]>` — fetches one poe.ninja category and tags each line with `_category`.
  - `cheapestByName(rawLines: object[]): {name: string, chaosValue: number, _category: string}[]` — pure function; collapses multiple lines with the same `name` down to the one with the lowest `chaosValue`, dropping lines with no `name` or non-numeric `chaosValue`.
  - `fetchAllPrices(league: string): Promise<{items: object[], errors: string[]}>` — fetches all three `CATEGORIES` in parallel, collects per-category errors instead of failing the whole call, and returns `cheapestByName` of everything fetched.

- [ ] **Step 1: Write the failing test**

Create `lib/poeNinja.test.js` (only `cheapestByName` is unit-tested — the `fetch*` functions require real network access and are covered by manual verification in Task 6/8, not automated tests):

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { cheapestByName } = require('./poeNinja');

test('cheapestByName keeps the lowest chaosValue per name', () => {
  const lines = [
    { name: 'Foo', chaosValue: 10, _category: 'UniqueWeapon' },
    { name: 'Foo', chaosValue: 5, _category: 'UniqueWeapon' },
    { name: 'Bar', chaosValue: 20, _category: 'UniqueArmour' },
  ];
  const result = cheapestByName(lines).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepStrictEqual(result, [
    { name: 'Bar', chaosValue: 20, _category: 'UniqueArmour' },
    { name: 'Foo', chaosValue: 5, _category: 'UniqueWeapon' },
  ]);
});

test('cheapestByName drops lines with no name or a non-numeric chaosValue', () => {
  const lines = [
    { chaosValue: 3, _category: 'UniqueWeapon' },
    { name: 'Foo', chaosValue: 'not-a-number', _category: 'UniqueWeapon' },
    { name: 'Foo', chaosValue: 7, _category: 'UniqueWeapon' },
  ];
  assert.deepStrictEqual(cheapestByName(lines), [{ name: 'Foo', chaosValue: 7, _category: 'UniqueWeapon' }]);
});

test('cheapestByName returns an empty array for empty input', () => {
  assert.deepStrictEqual(cheapestByName([]), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test lib/poeNinja.test.js`
Expected: FAIL — `Cannot find module './poeNinja'`

- [ ] **Step 3: Write the implementation**

Create `lib/poeNinja.js`:

```js
const https = require('node:https');

const CATEGORIES = ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory'];

function fetchJson(targetUrl, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    https.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (poe-dust)', 'Accept': 'application/json' }
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://poe.ninja${res.headers.location}`;
        return resolve(fetchJson(next, redirects + 1));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
    }).on('error', reject);
  });
}

function fetchLeagues() {
  return fetchJson('https://www.pathofexile.com/api/trade/data/leagues');
}

async function fetchCategoryLines(league, category) {
  const data = await fetchJson(
    `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=${category}`
  );
  return (data.lines || []).map(line => ({ ...line, _category: category }));
}

function cheapestByName(rawLines) {
  const best = new Map();
  for (const line of rawLines) {
    if (!line.name || typeof line.chaosValue !== 'number') continue;
    const existing = best.get(line.name);
    if (!existing || line.chaosValue < existing.chaosValue) {
      best.set(line.name, { name: line.name, chaosValue: line.chaosValue, _category: line._category });
    }
  }
  return [...best.values()];
}

async function fetchAllPrices(league) {
  const items = [];
  const errors = [];
  await Promise.all(CATEGORIES.map(async category => {
    try {
      const lines = await fetchCategoryLines(league, category);
      items.push(...lines);
    } catch (e) {
      errors.push(`${category}: ${e.message}`);
    }
  }));
  return { items: cheapestByName(items), errors };
}

module.exports = { CATEGORIES, fetchJson, fetchLeagues, fetchCategoryLines, cheapestByName, fetchAllPrices };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test lib/poeNinja.test.js`
Expected: PASS, 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/poeNinja.js lib/poeNinja.test.js
git commit -m "Add poe.ninja fetch client and cheapest-variant price selection"
```

---

## Task 5: One-time dust data import (`scripts/import-items.js`)

**Files:**
- Create: `scripts/seed.csv` (copy of the verified gist snapshot)
- Create: `scripts/import-items.js`
- Test: `scripts/import-items.test.js`

**Interfaces:**
- Consumes: `lib/db.js`'s `openDb`, `insertItem`.
- Produces:
  - `parseCsvLine(line: string): string[]` — minimal CSV line splitter that handles double-quoted fields containing commas (the seed data has exactly one such row: `"Jack, the Axe"`). No support for embedded newlines or escaped `""` quotes — verified unnecessary for `seed.csv`.
  - `parseSeedCsv(csvText: string): {name: string, dust84: number, dust84q20: number}[]` — parses the full CSV using its header row to locate the `name`, `dustValIlvl84`, `dustValIlvl84Q20` columns (order-independent), rounding both dust values to integers.
  - `run(csvPath: string, dbPath: string): number` — reads `csvPath`, opens/creates `dbPath` via `openDb`, `insertItem`s every parsed row, closes the db, returns the count imported.
  - CLI entry point (`require.main === module`): runs `run()` against `scripts/seed.csv` and `data/poe-dust.db`, printing the imported count.

- [ ] **Step 1: Copy the seed data into the repo**

The gist at `https://gist.github.com/alserom/22bdd4106806cbd4f85a5cb8c4345c08` was already downloaded and verified during design (1019 items; `dustValIlvl84Q20 == dustValIlvl84 * 1.2` for effectively all rows). Copy that snapshot into the repo so the import doesn't depend on the gist staying online:

```bash
cp "C:\Users\lsevc\AppData\Local\Temp\claude\E--docker-poe-dust\5174e39c-eb1b-47b0-a7d5-cf6097eea2ad\scratchpad\gist_raw.csv" "E:\docker\poe-dust\scripts\seed.csv"
```

(If that temp path no longer exists when this task is executed, re-download with:
`curl -sL "https://gist.githubusercontent.com/alserom/22bdd4106806cbd4f85a5cb8c4345c08/raw" -o scripts/seed.csv`
and re-verify the row count is close to 1019 and the header is
`name,baseType,dustVal,dustValIlvl84,dustValIlvl84Q20,dustPerSlot,w,h,slots,link`.)

- [ ] **Step 2: Write the failing test**

Create `scripts/import-items.test.js`:

```js
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

test('parseSeedCsv extracts name, dust84, and dust84q20 from every row', () => {
  const items = parseSeedCsv(FIXTURE_CSV);
  assert.deepStrictEqual(items, [
    { name: 'Original Sin', dust84: 2257780, dust84q20: 2709336 },
    { name: 'Jack, the Axe', dust84: 26520, dust84q20: 31824 },
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

  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test scripts/import-items.test.js`
Expected: FAIL — `Cannot find module './import-items'`

- [ ] **Step 4: Write the implementation**

Create `scripts/import-items.js`:

```js
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test scripts/import-items.test.js`
Expected: PASS, 3 tests passing.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed.csv scripts/import-items.js scripts/import-items.test.js
git commit -m "Add one-time dust data import from the seed CSV"
```

(This task only proves the import logic works — it does not yet populate the real `data/poe-dust.db` used by the running app. That happens in Task 9, after `server.js` exists and the `.gitignore` rules for `data/` are in place.)

---

## Task 6: HTTP server (`server.js`)

**Files:**
- Create: `server.js`
- Test: `server.test.js`

**Interfaces:**
- Consumes: `lib/db.js` (`getAllItems`, `updateItem`), `lib/auth.js` (`login`, `logout`, `isValidSession`, `parseCookies`, `SESSION_TTL_MS`), `lib/priceCache.js` (`readCache`, `writeCache`, `isFresh`), `lib/poeNinja.js` (`fetchLeagues`, `fetchAllPrices`, as injectable defaults).
- Produces:
  - `createServer(opts): http.Server` — `opts`: `{ dbConn, cacheDir, staticDir = __dirname, fetchLeagues = poeNinja.fetchLeagues, fetchAllPrices = poeNinja.fetchAllPrices, adminPassword = process.env.ADMIN_PASSWORD }`. Dependency injection here (rather than hardcoded module calls) is what lets the test suite hit real HTTP routes without real network access.
  - `resolveStaticPath(staticDir: string, pathname: string): string | null` — pure helper; `null` means "outside staticDir, refuse to serve" (path traversal guard).
  - Routes: `GET /api/leagues`, `GET /api/cache-status?league=`, `GET /api/prices?league=`, `GET /api/items`, `GET /api/admin/session`, `POST /api/admin/login`, `POST /api/admin/logout`, `PUT /api/admin/items/:name`, static file fallback.

- [ ] **Step 1: Write the failing test**

Create `server.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test server.test.js`
Expected: FAIL — `Cannot find module './server'`

- [ ] **Step 3: Write the implementation**

Create `server.js`:

```js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const db = require('./lib/db');
const auth = require('./lib/auth');
const priceCache = require('./lib/priceCache');
const poeNinja = require('./lib/poeNinja');

const CACHE_TTL = 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function getSessionToken(req) {
  return auth.parseCookies(req.headers.cookie).session;
}

function resolveStaticPath(staticDir, pathname) {
  const safePathname = pathname === '/' ? '/index.html' : pathname;
  const resolvedStaticDir = path.resolve(staticDir);
  const resolvedFilePath = path.resolve(path.join(staticDir, safePathname));
  if (resolvedFilePath !== resolvedStaticDir && !resolvedFilePath.startsWith(resolvedStaticDir + path.sep)) {
    return null;
  }
  return resolvedFilePath;
}

function createServer({
  dbConn,
  cacheDir,
  staticDir = __dirname,
  fetchLeagues = poeNinja.fetchLeagues,
  fetchAllPrices = poeNinja.fetchAllPrices,
  adminPassword = process.env.ADMIN_PASSWORD,
} = {}) {
  return http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    if (pathname === '/api/leagues' && req.method === 'GET') {
      fetchLeagues()
        .then(data => sendJson(res, 200, data))
        .catch(e => sendJson(res, 502, { error: e.message }));
      return;
    }

    if (pathname === '/api/cache-status' && req.method === 'GET') {
      const league = parsedUrl.query.league;
      if (!league) return sendJson(res, 400, { error: 'missing league' });
      const cached = priceCache.readCache(cacheDir, league);
      if (!cached) return sendJson(res, 200, { timestamp: null, fresh: false });
      return sendJson(res, 200, { timestamp: cached.timestamp, fresh: priceCache.isFresh(cached.timestamp, CACHE_TTL) });
    }

    if (pathname === '/api/prices' && req.method === 'GET') {
      const league = parsedUrl.query.league;
      if (!league) return sendJson(res, 400, { error: 'missing league' });
      const cached = priceCache.readCache(cacheDir, league);
      if (cached && priceCache.isFresh(cached.timestamp, CACHE_TTL)) {
        return sendJson(res, 200, { ...cached, fromCache: true });
      }
      fetchAllPrices(league)
        .then(({ items, errors }) => {
          const payload = { timestamp: Date.now(), items, errors };
          priceCache.writeCache(cacheDir, league, payload);
          sendJson(res, 200, { ...payload, fromCache: false });
        })
        .catch(e => sendJson(res, 500, { error: e.message }));
      return;
    }

    if (pathname === '/api/items' && req.method === 'GET') {
      return sendJson(res, 200, db.getAllItems(dbConn));
    }

    if (pathname === '/api/admin/session' && req.method === 'GET') {
      return sendJson(res, 200, { authenticated: auth.isValidSession(getSessionToken(req)) });
    }

    if (pathname === '/api/admin/login' && req.method === 'POST') {
      readJsonBody(req)
        .then(body => {
          const token = auth.login(body.password, adminPassword);
          if (!token) return sendJson(res, 401, { error: 'invalid password' });
          res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(auth.SESSION_TTL_MS / 1000)}`);
          sendJson(res, 200, { ok: true });
        })
        .catch(e => sendJson(res, 400, { error: e.message }));
      return;
    }

    if (pathname === '/api/admin/logout' && req.method === 'POST') {
      auth.logout(getSessionToken(req));
      res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
      return sendJson(res, 200, { ok: true });
    }

    const itemMatch = pathname.match(/^\/api\/admin\/items\/(.+)$/);
    if (itemMatch && req.method === 'PUT') {
      if (!auth.isValidSession(getSessionToken(req))) return sendJson(res, 401, { error: 'not authenticated' });
      const name = decodeURIComponent(itemMatch[1]);
      readJsonBody(req)
        .then(body => {
          const changed = db.updateItem(dbConn, name, body);
          if (changed === 0) return sendJson(res, 404, { error: 'item not found' });
          sendJson(res, 200, { ok: true });
        })
        .catch(e => sendJson(res, 400, { error: e.message }));
      return;
    }

    const filePath = resolveStaticPath(staticDir, pathname);
    if (!filePath) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

module.exports = { createServer, resolveStaticPath };

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  const dataDir = path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = process.env.POE_DUST_DB_PATH || path.join(dataDir, 'poe-dust.db');
  const dbConn = db.openDb(dbPath);
  const cacheDir = path.join(__dirname, 'cache');
  const server = createServer({ dbConn, cacheDir });
  server.listen(PORT, () => {
    console.log(`poe-dust running on http://localhost:${PORT}`);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test server.test.js`
Expected: PASS, 10 tests passing.

- [ ] **Step 5: Commit**

```bash
git add server.js server.test.js
git commit -m "Add HTTP server wiring db, auth, price cache, and poe.ninja routes"
```

---

## Task 7: Docker / Compose / package.json scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `Dockerfile`
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: `server.js` as the container entry point.
- Produces: a runnable local environment on `http://localhost:3001`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "poe-dust",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test",
    "import": "node scripts/import-items.js"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.env
data/
cache/
```

- [ ] **Step 3: Create `Dockerfile`**

```
FROM node:22-alpine
WORKDIR /app
COPY server.js index.html package.json ./
COPY lib ./lib
CMD ["node", "server.js"]
```

- [ ] **Step 4: Create `docker-compose.yml`**

```yaml
services:
  poe-dust:
    image: node:22-alpine
    container_name: poe-dust
    working_dir: /app
    volumes:
      - .:/app
    command: node server.js
    ports:
      - "3001:3001"
    environment:
      - PORT=3001
      - ADMIN_PASSWORD=changeme
    restart: "no"
```

- [ ] **Step 5: Verify the container starts and serves the API**

Run:
```bash
docker compose up -d
sleep 2
curl -s http://localhost:3001/api/items
docker compose logs --tail 20
docker compose down
```
Expected: `curl` prints `[]` (no items imported yet — that's Task 9), and the logs show `poe-dust running on http://localhost:3001` with no errors or `ExperimentalWarning` treated as fatal.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore Dockerfile docker-compose.yml
git commit -m "Add Docker Compose scaffolding for local poe-dust runs"
```

---

## Task 8: Frontend (`index.html`)

**Files:**
- Create: `index.html`

**Interfaces:**
- Consumes: `GET /api/items`, `GET /api/leagues`, `GET /api/cache-status`, `GET /api/prices`, `GET /api/admin/session`, `POST /api/admin/login`, `POST /api/admin/logout`, `PUT /api/admin/items/:name` (all from Task 6).
- Produces: the full user-facing page. No other file depends on this one.

There is no automated test for this task — it's a static page with inline JS and no headless-browser tooling in this project (matching heist, which also has no frontend tests). Verification is manual, via Step 2 below.

- [ ] **Step 1: Write `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>POE Dust prices</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #f4efe6;
      color: #1a0e04;
      font-family: 'Segoe UI', sans-serif;
      min-height: 100vh;
    }

    header {
      background: linear-gradient(180deg, #ede5d0 0%, #f4efe6 100%);
      border-bottom: 2px solid #c8a870;
      padding: 1.25rem 2rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
    }

    .header-top {
      display: flex;
      align-items: center;
      gap: 2rem;
      flex-wrap: wrap;
    }

    header h1 {
      font-size: 1.6rem;
      color: #7a3010;
      text-shadow: 0 1px 0 #fffdf5;
      white-space: nowrap;
    }
    header h1 span { color: #1a0e04; }

    .controls {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .controls label { font-size: 0.85rem; color: #6a5030; }

    input[type="text"], input[type="number"] {
      background: #fffdf5;
      border: 1px solid #c8a870;
      color: #1a0e04;
      padding: 0.4rem 0.75rem;
      border-radius: 4px;
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.2s;
    }
    input[type="text"] { width: 180px; }
    input[type="number"] { width: 90px; }
    input:focus { border-color: #7a3010; }

    button { font-family: inherit; cursor: pointer; border-radius: 4px; font-size: 0.9rem; }

    button#loadBtn {
      background: linear-gradient(180deg, #c87830 0%, #7a3010 100%);
      border: 1px solid #7a3010;
      color: #fffdf5;
      padding: 0.45rem 1.25rem;
      transition: filter 0.2s;
      white-space: nowrap;
    }
    button#loadBtn:hover { filter: brightness(1.15); }
    button#loadBtn:disabled { opacity: 0.45; cursor: not-allowed; filter: none; }

    button#filterBtn, button#loginBtn, button#logoutBtn, button#loginSubmit {
      background: linear-gradient(180deg, #e8dcc0 0%, #c8a870 100%);
      border: 1px solid #a07840;
      color: #1a0e04;
      padding: 0.45rem 1rem;
      transition: filter 0.2s;
    }
    button#filterBtn:hover, button#loginBtn:hover, button#logoutBtn:hover, button#loginSubmit:hover { filter: brightness(1.1); }

    .admin-area { margin-left: auto; position: relative; display: flex; align-items: center; gap: 0.5rem; }

    .login-box {
      position: absolute;
      top: 120%;
      right: 0;
      background: #fffdf5;
      border: 1px solid #c8a870;
      border-radius: 6px;
      padding: 0.75rem;
      display: none;
      gap: 0.5rem;
      flex-direction: column;
      box-shadow: 0 4px 20px #00000020;
      z-index: 10;
      min-width: 220px;
    }
    .login-box.visible { display: flex; }
    .login-error { color: #8a2020; font-size: 0.78rem; display: none; }
    .login-error.visible { display: block; }

    .type-btn {
      background: #ede5d0;
      border: 1px solid #c8a870;
      color: #6a5030;
      padding: 0.3rem 0.9rem;
      border-radius: 20px;
      font-size: 0.82rem;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .type-btn:hover { border-color: #7a3010; color: #1a0e04; background: #e0d4b8; }
    .type-btn.active { background: #7a3010; border-color: #7a3010; color: #fffdf5; }

    #status {
      padding: 0.75rem 2rem;
      font-size: 0.85rem;
      color: #6a5030;
      min-height: 2.5rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .spinner {
      width: 16px; height: 16px;
      border: 2px solid #c8a870;
      border-top-color: #7a3010;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      display: none;
    }
    .spinner.active { display: block; }
    @keyframes spin { to { transform: rotate(360deg); } }

    #count-badge {
      background: #ede5d0;
      border: 1px solid #c8a870;
      border-radius: 20px;
      padding: 0.15rem 0.6rem;
      font-size: 0.8rem;
      color: #7a3010;
      font-weight: 600;
    }

    .error-msg {
      color: #8a2020;
      background: #fdf0f0;
      border: 1px solid #d4a0a0;
      border-radius: 4px;
      padding: 0.5rem 1rem;
      font-size: 0.85rem;
    }

    main { padding: 0.5rem 2rem 3rem; overflow-x: auto; }

    table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }

    thead th {
      background: #ede5d0;
      border-bottom: 2px solid #c8a870;
      color: #7a3010;
      font-weight: 600;
      padding: 0.5rem 0.7rem;
      text-align: right;
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
    }
    thead th:nth-child(1), thead th:nth-child(2) { text-align: left; }
    thead th.sorted { color: #1a0e04; background: #e0d4b8; }
    thead th .arrow { font-size: 0.7rem; margin-left: 0.2rem; }

    tbody td {
      border-bottom: 1px solid #e0d4b8;
      padding: 0.4rem 0.7rem;
      text-align: right;
      white-space: nowrap;
    }
    tbody td:nth-child(1), tbody td:nth-child(2) { text-align: left; }
    tbody tr:hover { background: #f8f0e0; }

    .empty-row td { text-align: center; color: #8a6840; padding: 3rem; }

    td input[type="number"] { width: 90px; text-align: right; padding: 0.2rem 0.4rem; }
  </style>
</head>
<body>

<header>
  <div class="header-top">
    <h1>POE <span>Dust</span> prices</h1>
    <div class="admin-area">
      <button id="loginBtn">Login</button>
      <button id="logoutBtn" style="display:none">Logout</button>
      <div class="login-box" id="loginBox">
        <label>Admin password:
          <input type="text" id="loginPassword" autocomplete="current-password" style="width:160px">
        </label>
        <div class="login-error" id="loginError"></div>
        <button id="loginSubmit">Sign in</button>
      </div>
    </div>
  </div>
  <div class="controls">
    <label>League:</label>
    <input type="text" id="leagueInput" value="" placeholder="detecting…" />
    <button id="loadBtn">Load</button>
    <label>Min (chaos):</label>
    <input type="number" id="minChaos" value="0" min="0" step="1" />
    <label>Max (chaos):</label>
    <input type="number" id="maxChaos" value="" min="0" step="1" placeholder="∞" />
    <button id="filterBtn">Filter</button>
  </div>
  <div class="controls">
    <input type="text" id="nameFilter" placeholder="Search items…" />
    <div id="type-filter" style="display:flex; gap:0.5rem;"></div>
  </div>
</header>

<div id="status">
  <div class="spinner" id="spinner"></div>
  <span id="statusText">Detecting current league…</span>
  <span id="count-badge" style="display:none"></span>
</div>

<main>
  <table>
    <thead><tr id="headerRow"></tr></thead>
    <tbody id="tbody"></tbody>
  </table>
</main>

<script>
const COLUMNS = [
  { key: 'name', label: 'Name', numeric: false },
  { key: '_category', label: 'Type', numeric: false },
  { key: 'chaosValue', label: 'Price (c)', numeric: true },
  { key: 'dust83', label: '83', numeric: true },
  { key: 'dust83q20', label: '83+20', numeric: true },
  { key: 'eff83', label: 'c/dust 83', numeric: true },
  { key: 'dust84', label: '84', numeric: true },
  { key: 'dust84q20', label: '84+20', numeric: true },
  { key: 'eff84', label: 'c/dust 84', numeric: true },
  { key: 'dust85', label: '85', numeric: true },
  { key: 'dust85q20', label: '85+20', numeric: true },
  { key: 'eff85', label: 'c/dust 85', numeric: true },
];
const EDITABLE_COLUMNS = ['dust83', 'dust83q20', 'dust84', 'dust84q20', 'dust85', 'dust85q20'];
const TYPE_LABELS = { UniqueWeapon: 'Weapon', UniqueArmour: 'Armour', UniqueAccessory: 'Jewellery' };
const CACHE_TTL = 60 * 60 * 1000;
const SKIP_LEAGUES = new Set(['Standard', 'Hardcore', 'SSF Standard', 'SSF Hardcore']);

let rawItems = [];
let priceByName = new Map();
let mergedItems = [];
let isAdmin = false;
let sortKey = 'chaosValue';
let sortDir = 'desc';
let activeType = 'all';
let nameQuery = '';
let minChaos = 0;
let maxChaos = Infinity;
let refreshBlockedUntil = 0;
let btnInterval = null;

function computeEfficiency(dustQ20, chaosValue) {
  if (dustQ20 == null || !chaosValue) return null;
  return dustQ20 / chaosValue;
}

function mergeItemsWithPrices() {
  const merged = [];
  for (const item of rawItems) {
    const price = priceByName.get(item.name);
    if (!price) continue;
    merged.push({
      ...item,
      chaosValue: price.chaosValue,
      _category: price._category,
      eff83: computeEfficiency(item.dust83q20, price.chaosValue),
      eff84: computeEfficiency(item.dust84q20, price.chaosValue),
      eff85: computeEfficiency(item.dust85q20, price.chaosValue),
    });
  }
  mergedItems = merged;
}

function renderHeader() {
  const row = document.getElementById('headerRow');
  row.innerHTML = '';
  for (const col of COLUMNS) {
    const th = document.createElement('th');
    const arrow = sortKey === col.key ? `<span class="arrow">${sortDir === 'asc' ? '\u25b2' : '\u25bc'}</span>` : '';
    th.innerHTML = col.label + arrow;
    if (sortKey === col.key) th.classList.add('sorted');
    th.addEventListener('click', () => {
      if (sortKey === col.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = col.key; sortDir = col.numeric ? 'desc' : 'asc'; }
      renderHeader();
      applyAndRender();
    });
    row.appendChild(th);
  }
}

function formatNumber(n) {
  if (n == null) return '\u2014';
  return Math.round(n).toLocaleString('en-US');
}

function formatEfficiency(n) {
  if (n == null) return '\u2014';
  return n.toFixed(2);
}

async function saveEdit(name, field, value) {
  const parsed = value === '' ? null : Math.round(parseFloat(value));
  const res = await fetch(`/api/admin/items/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [field]: parsed }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const item = rawItems.find(i => i.name === name);
  if (item) item[field] = parsed;
  mergeItemsWithPrices();
}

function editableCell(item, field) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'number';
  input.value = item[field] ?? '';
  const commit = () => {
    saveEdit(item.name, field, input.value).catch(e => {
      input.value = item[field] ?? '';
      alert(`Save failed: ${e.message}`);
    });
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  td.appendChild(input);
  return td;
}

function renderRows(items) {
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  if (items.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${COLUMNS.length}">No items match the current filters.</td></tr>`;
    return;
  }
  for (const item of items) {
    const tr = document.createElement('tr');
    for (const col of COLUMNS) {
      if (isAdmin && EDITABLE_COLUMNS.includes(col.key)) {
        tr.appendChild(editableCell(item, col.key));
        continue;
      }
      const td = document.createElement('td');
      if (col.key === 'name') td.textContent = item.name;
      else if (col.key === '_category') td.textContent = TYPE_LABELS[item._category] || item._category;
      else if (col.key === 'chaosValue') td.textContent = formatNumber(item.chaosValue);
      else if (col.key.startsWith('eff')) td.textContent = formatEfficiency(item[col.key]);
      else td.textContent = formatNumber(item[col.key]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function sortItems(items) {
  const sorted = [...items];
  sorted.sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });
  return sorted;
}

function renderTypeFilter() {
  const bar = document.getElementById('type-filter');
  bar.innerHTML = '';
  const presentTypes = [...new Set(mergedItems.map(i => i._category))];
  for (const type of ['all', ...presentTypes]) {
    const btn = document.createElement('button');
    btn.className = 'type-btn' + (type === activeType ? ' active' : '');
    btn.textContent = type === 'all' ? 'All' : (TYPE_LABELS[type] || type);
    btn.addEventListener('click', () => { activeType = type; renderTypeFilter(); applyAndRender(); });
    bar.appendChild(btn);
  }
}

function applyAndRender() {
  let filtered = mergedItems;
  if (activeType !== 'all') filtered = filtered.filter(i => i._category === activeType);
  if (minChaos > 0) filtered = filtered.filter(i => i.chaosValue >= minChaos);
  if (maxChaos < Infinity) filtered = filtered.filter(i => i.chaosValue <= maxChaos);
  if (nameQuery) filtered = filtered.filter(i => i.name.toLowerCase().includes(nameQuery));
  const sorted = sortItems(filtered);
  renderRows(sorted);
  const badge = document.getElementById('count-badge');
  badge.textContent = `${sorted.length} items`;
  badge.style.display = 'inline';
}

function updateLoadBtn() {
  const btn = document.getElementById('loadBtn');
  const remaining = refreshBlockedUntil - Date.now();
  if (remaining > 0) {
    btn.disabled = true;
    btn.textContent = `Load (${Math.ceil(remaining / 60000)}m)`;
  } else {
    btn.disabled = false;
    btn.textContent = 'Load';
  }
}

async function loadPrices() {
  const league = document.getElementById('leagueInput').value.trim();
  if (!league) { alert('Enter a league name.'); return; }
  const btn = document.getElementById('loadBtn');
  const spinner = document.getElementById('spinner');
  const statusText = document.getElementById('statusText');
  btn.disabled = true;
  spinner.classList.add('active');
  statusText.textContent = 'Loading prices from poe.ninja\u2026';
  try {
    const res = await fetch(`/api/prices?league=${encodeURIComponent(league)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    priceByName = new Map(data.items.map(i => [i.name, i]));
    mergeItemsWithPrices();
    renderTypeFilter();
    applyAndRender();
    refreshBlockedUntil = data.timestamp + CACHE_TTL;
    if (btnInterval) clearInterval(btnInterval);
    btnInterval = setInterval(updateLoadBtn, 30000);
    updateLoadBtn();
    const ageMins = Math.round((Date.now() - data.timestamp) / 60000);
    const ageStr = data.fromCache ? ` (cached ${ageMins}m ago)` : '';
    statusText.textContent = data.errors && data.errors.length
      ? `Errors: ${data.errors.join(', ')}`
      : `Loaded \u2014 league "${league}"${ageStr}.`;
  } catch (e) {
    statusText.innerHTML = `<span class="error-msg">Error: ${e.message}</span>`;
    updateLoadBtn();
  } finally {
    spinner.classList.remove('active');
  }
}

async function loadItems() {
  const res = await fetch('/api/items');
  rawItems = await res.json();
  mergeItemsWithPrices();
}

async function detectCurrentLeague() {
  const input = document.getElementById('leagueInput');
  const statusText = document.getElementById('statusText');
  try {
    const res = await fetch('/api/leagues');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const leagues = data.result ?? data;
    const challenge = leagues.find(l =>
      !SKIP_LEAGUES.has(l.id) && !l.id.startsWith('SSF ') && !l.id.startsWith('Hardcore ')
    );
    input.value = challenge ? challenge.id : 'Standard';
  } catch (e) {
    input.value = 'Standard';
    statusText.textContent = 'League detection error: ' + e.message;
    return;
  }
  const league = input.value;
  try {
    const res = await fetch(`/api/cache-status?league=${encodeURIComponent(league)}`);
    const status = await res.json();
    if (!status.timestamp) {
      statusText.textContent = `League: ${league} \u2014 no data yet, click Load.`;
    } else if (!status.fresh) {
      const ageMins = Math.round((Date.now() - status.timestamp) / 60000);
      statusText.innerHTML = `League: ${league} \u2014 <strong>data is ${ageMins}m old</strong>, click Load to refresh.`;
    } else {
      refreshBlockedUntil = status.timestamp + CACHE_TTL;
      loadPrices();
    }
  } catch (e) {
    statusText.textContent = `League: ${league} \u2014 click Load to fetch data.`;
  }
}

async function checkAdminSession() {
  const res = await fetch('/api/admin/session');
  const data = await res.json();
  isAdmin = !!data.authenticated;
  updateAdminUI();
}

function updateAdminUI() {
  document.getElementById('loginBtn').style.display = isAdmin ? 'none' : 'inline-block';
  document.getElementById('logoutBtn').style.display = isAdmin ? 'inline-block' : 'none';
  document.getElementById('loginBox').classList.remove('visible');
  applyAndRender();
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.classList.add('visible');
}

document.getElementById('loadBtn').addEventListener('click', loadPrices);
document.getElementById('leagueInput').addEventListener('keydown', e => { if (e.key === 'Enter') loadPrices(); });
document.getElementById('filterBtn').addEventListener('click', () => {
  minChaos = parseFloat(document.getElementById('minChaos').value) || 0;
  const maxVal = document.getElementById('maxChaos').value;
  maxChaos = maxVal === '' ? Infinity : parseFloat(maxVal);
  applyAndRender();
});
document.getElementById('nameFilter').addEventListener('input', e => {
  nameQuery = e.target.value.trim().toLowerCase();
  applyAndRender();
});
document.getElementById('loginBtn').addEventListener('click', () => {
  document.getElementById('loginBox').classList.add('visible');
});
document.getElementById('loginSubmit').addEventListener('click', async () => {
  const password = document.getElementById('loginPassword').value;
  document.getElementById('loginError').classList.remove('visible');
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) { showLoginError('Wrong password.'); return; }
    isAdmin = true;
    document.getElementById('loginPassword').value = '';
    updateAdminUI();
  } catch (e) {
    showLoginError(e.message);
  }
});
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  isAdmin = false;
  updateAdminUI();
});

renderHeader();
checkAdminSession();
loadItems().then(() => { renderTypeFilter(); applyAndRender(); });
detectCurrentLeague();
</script>

</body>
</html>
```

- [ ] **Step 2: Manual verification**

```bash
docker compose up -d
```

Then, in a browser, open `http://localhost:3001` and check:
1. The page loads, league auto-detects, status line updates.
2. Click **Load** — after a few seconds the table populates with items that have both dust data and a live poe.ninja price; items without a poe.ninja match do not appear.
3. Clicking **Load** again immediately shows the button disabled with a countdown (rate-limited for the cache TTL).
4. Sort by clicking different column headers; the arrow indicator flips direction on repeat clicks.
5. Type into the search box and set min/max chaos + click Filter — the row count updates accordingly.
6. Click **Login**, enter the wrong password — see the inline error; enter `ADMIN_PASSWORD` from `docker-compose.yml` (`changeme`) — the dust columns become editable inputs.
7. Edit a `dust83` cell, press Enter — reload the page — the edit persisted (proves the SQLite write worked).
8. Click **Logout** — dust columns become plain text again.

Then:
```bash
docker compose down
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Add poe-dust table UI with sorting, filters, and inline admin editing"
```

---

## Task 9: Populate the local database and finalize docs

**Files:**
- Modify: `readme.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `scripts/import-items.js` (Task 5), `server.js`/`docker-compose.yml` (Tasks 6-7).
- Produces: a working local `data/poe-dust.db` (untracked, per `.gitignore`) and up-to-date project docs for the next person (or agent) who opens the repo.

- [ ] **Step 1: Run the import for real**

```bash
node scripts/import-items.js
```

Expected output: `Imported 1019 items into E:\docker\poe-dust\data\poe-dust.db` (count may differ slightly if `seed.csv` changed since Task 5).

- [ ] **Step 2: Full local run-through**

```bash
docker compose up -d
curl -s http://localhost:3001/api/items | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.length, 'items,', 'sample:', d[0]);"
docker compose down
```

Expected: prints `1019 items, sample: { name: ..., dust83: null, ... }` (or the actual imported count) — confirms the bind-mounted `data/poe-dust.db` is readable inside the container.

- [ ] **Step 3: Update `CLAUDE.md`**

Replace the placeholder content written before this project existed with real guidance, following the same structure as `E:\docker\heist\CLAUDE.md`:

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Path of Exile unique-item "dust" tracker: shows disenchant dust yield at
item levels 83/84/85 (base and +20% quality) next to each item's current
poe.ninja chaos price and a dust-per-chaos efficiency ratio. Modeled on
`E:\docker\heist`. Design spec: `docs/superpowers/specs/2026-08-09-poe-dust-design.md`.
Implementation plan: `docs/superpowers/plans/2026-08-09-poe-dust-implementation.md`.

## Running

```bash
# Directly with Node.js
node server.js

# Via Docker Compose (preferred for local dev)
docker compose up -d
```

Server starts on port 3001 (or `$PORT`). No `npm install` needed — zero
dependencies, only Node built-ins (including `node:sqlite`).

Set `ADMIN_PASSWORD` (env var) to enable admin login for editing dust values
in the UI. `docker-compose.yml` sets it to `changeme` for local dev.

## Tests

```bash
node --test
```

Runs every `*.test.js` file (colocated with the module it tests).

## Architecture

- `server.js` — HTTP server wiring together the modules below. `createServer(opts)`
  takes injectable dependencies so tests can hit real routes without real network
  or a real database file.
- `lib/db.js` — SQLite (`node:sqlite`) access to the `items` table (`name`,
  `dust83`, `dust83q20`, `dust84`, `dust84q20`, `dust85`, `dust85q20`).
- `lib/auth.js` — single-shared-password admin sessions (in-memory token map,
  24h TTL, `HttpOnly` cookie).
- `lib/priceCache.js` — 1-hour file cache for poe.ninja responses (`cache/<league>.json`).
- `lib/poeNinja.js` — poe.ninja HTTP client; fetches `UniqueWeapon`/`UniqueArmour`/
  `UniqueAccessory`, collapses link-count variants to the cheapest `chaosValue` per name.
- `index.html` — self-contained SPA (inline CSS/JS, no build step). Fetches
  `/api/items` (dust data) and `/api/prices` (live prices) separately and joins
  them client-side by item name; items with no price match are hidden.
- `scripts/import-items.js` + `scripts/seed.csv` — one-time seed of `data/poe-dust.db`
  from a community-sourced dust-value dataset. Re-running it overwrites `dust84`/
  `dust84q20` for every item currently in `seed.csv` but leaves other admin-edited
  columns alone (upsert, not replace) — admin edits to `dust83`/`dust85` values on
  items also present in `seed.csv` survive a re-import.

## Key details

- `data/` and `cache/` are both `.gitignore`d. `data/poe-dust.db` must exist
  locally before the server has anything to show — run `node scripts/import-items.js`
  once after cloning.
- Production deployment (Render) and how `data/poe-dust.db` persists there is
  an open question, deliberately out of scope so far — see the design spec's
  "Out of scope" section.
```

- [ ] **Step 4: Update `readme.md`**

Add a short pointer at the top (keep the original Czech requirements text below it unchanged, since it's the original brief):

```markdown
> Implemented — see `CLAUDE.md` for how to run it, and
> `docs/superpowers/specs/2026-08-09-poe-dust-design.md` /
> `docs/superpowers/plans/2026-08-09-poe-dust-implementation.md` for the design
> and implementation history.

```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md readme.md
git commit -m "Document poe-dust architecture and local setup"
```

(`data/poe-dust.db` itself is intentionally not committed — it's `.gitignore`d, matching how heist treats its own `cache/`.)

---

## Self-review notes

- **Spec coverage:** every spec section maps to a task — data model & SQLite (Task 1), auth (Task 2), price cache (Task 3), poe.ninja matching (Task 4), import (Task 5), all backend endpoints (Task 6), local Docker deployment (Task 7), frontend table/filters/sort/admin-edit (Task 8), real data population + docs (Task 9). Production Render persistence is out of scope per the spec and is not a task here.
- **Flagged ambiguity:** the "přepočet na 1 chaos" formula (Global Constraints, and repeated at Task 8) is called out explicitly as an interpretation, not a silent guess — confirm with the user once the table is visible.
- **Type consistency check:** `DUST_COLUMNS`/column names (`dust83`, `dust83q20`, `dust84`, `dust84q20`, `dust85`, `dust85q20`) are identical across `lib/db.js`, `scripts/import-items.js`, `server.js`, and `index.html`. `createServer`'s option names (`dbConn`, `cacheDir`, `staticDir`, `fetchLeagues`, `fetchAllPrices`, `adminPassword`) are used consistently between Task 6's implementation and its tests. `resolveStaticPath` is exported from `server.js` and used both internally and directly in `server.test.js`.
