# poe-dust — design spec

Date: 2026-08-09

## Purpose

A web app, architecturally modeled on the existing `E:\docker\heist` project, that
shows Path of Exile unique items (weapons, armour, jewellery/accessories) alongside
how much "dust" they yield when disenchanted at item levels 83/84/85 (with and
without 20% quality), their current chaos price from poe.ninja, and a computed
dust-per-chaos efficiency ratio — so a player can find the cheapest uniques to
buy for dust farming.

Reference implementation: `E:\docker\heist` (a zero-dependency Node.js PoE price
tracker). poe-dust reuses its architecture, styling conventions, and deployment
pattern wherever it fits, and diverges only where the requirements differ
(persistent admin-editable data, a table instead of a card grid, login).

## Architecture

Same shape as heist: a single zero-dependency Node.js `http` server
(`server.js`, Node built-ins only, no `npm install`) serving one self-contained
`index.html` (inline CSS/JS, no build step, no framework).

```
poe-dust/
  server.js
  index.html
  data/
    poe-dust.db          # persistent, admin-editable dust data (source of truth) — SQLite
  cache/
    <league>.json        # ephemeral poe.ninja price cache, 1h TTL (like heist)
  scripts/
    seed.csv              # one-time snapshot of the gist import source
    import-items.js       # one-time script: seed.csv -> data/poe-dust.db
  Dockerfile
  docker-compose.yml
  package.json
```

`data/` (admin-edited, must survive) is conceptually distinct from `cache/`
(regenerable poe.ninja price snapshots, safe to lose). heist's own `cache/` is
fully `.gitignore`d and never treated as durable — it's a throwaway pattern,
not a persistence pattern. Reusing a hand-written JSON file for `data/` would
borrow that "safe to lose / safe to partially overwrite" cache semantics for
data that must NOT have those properties, so `data/` uses a real embedded
database instead: **SQLite via Node's built-in `node:sqlite` module**
(available unflagged in the Node 22 line by now — no `npm install`, no native
addon, no external service, staying true to heist's zero-dependency approach).
`data/poe-dust.db` is a single file, still trivially bind-mountable for local
persistence, but with transactional writes instead of whole-file rewrites.

## Data model

A single SQLite table, the persistent source of truth for dust values:

```sql
CREATE TABLE items (
  name       TEXT PRIMARY KEY,
  dust83     INTEGER,
  dust83q20  INTEGER,
  dust84     INTEGER,
  dust84q20  INTEGER,
  dust85     INTEGER,
  dust85q20  INTEGER
);
```

It does **not** store item type or price — both are derived at request time by
joining against live poe.ninja data by item `name`. An item with no matching
poe.ninja Unique{Weapon,Armour,Accessory} entry in the current league simply
does not appear in the table (no dead rows, no manual type tagging needed).

Field semantics:
- `dust<ilvl>` — dust yield when disenchanting the item found at that item level, no quality.
- `dust<ilvl>q20` — dust yield at that item level with 20% quality. For weapons/armour
  this is a real "Orb of Dust"-equivalent value; for jewellery/accessories (rings,
  amulets, belts) the readme notes the real-world mechanic uses catalysts instead of
  dust for the quality bonus — the column is reused for that number too (same shape,
  different in-game currency backing it). The UI labels this column so it reads
  correctly for both cases (see UI section).
- All six columns are independently admin-editable. Only `dust84`/`dust84q20` are
  seeded by the initial import; `dust83*`/`dust85*` start `NULL` and are filled in
  by the admin over time. A `NULL` value renders as an empty cell and is excluded
  from the dust-per-chaos calculation for that column (shown as `—`).

## Initial data import

Source: https://gist.github.com/alserom/22bdd4106806cbd4f85a5cb8c4345c08 (a richer,
more current derivative of the Google Sheet referenced in the project README —
verified to contain `name`, `baseType`, `dustValIlvl84`, `dustValIlvl84Q20` for
1019 unique items). Verified programmatically that `dustValIlvl84Q20 ==
dustValIlvl84 * 1.2` for effectively all rows (1018/1019; the one mismatch was a
CSV-quoting artifact in the verification script, not a data issue).

Process (one-time, run manually, not part of the running server):
1. `scripts/seed.csv` — a committed snapshot of the gist CSV (so the import is
   reproducible without depending on the gist staying online).
2. `scripts/import-items.js` — reads `seed.csv`, creates `data/poe-dust.db` (via
   `node:sqlite`) with the `items` table above, and inserts one row per CSV line:
   - `name` = CSV `name`
   - `dust84` = CSV `dustValIlvl84` (parsed as integer)
   - `dust84q20` = CSV `dustValIlvl84Q20` (parsed as integer; not recomputed, the
     source value is used as-is even though it's derivable)
   - `dust83`, `dust83q20`, `dust85`, `dust85q20` = `NULL`
3. Run once locally against a fresh checkout to produce the initial
   `data/poe-dust.db`. Unlike the earlier JSON-file plan, a binary SQLite file
   is not meant to be diffed/reviewed in git — see Local development section
   for how it's distributed instead.

This script is not exposed via any HTTP endpoint — it's a local maintenance tool,
run again only if the dataset needs to be rebuilt from scratch (existing
admin edits in `data/poe-dust.db` would be lost if re-run, so this is a
deliberate, rare operation).

## poe.ninja price matching

Reuses heist's `fetchJson` helper and its 1-hour file-cache pattern
(`cache/<league>.json`, `{ timestamp, items, errors }`, same TTL constant).

- Queried categories: `UniqueWeapon`, `UniqueArmour`, `UniqueAccessory` (rings,
  amulets, belts — the "jewellery" of the README). `UniqueJewel` (socketable
  jewels) is explicitly excluded — those aren't disenchanted for dust.
- For items with multiple poe.ninja listings (e.g. weapons split by link count),
  the **cheapest chaosValue across all variants** is used as "price in chaos" —
  link count is irrelevant to dust yield.
- The item's `_category` (which of the three poe.ninja endpoints it came from)
  is used directly as its "type" for the UI's type filter and as the badge in
  the type column — no separate type field is stored or maintained.
- Matching key is exact `name` equality between the `items` table and the
  poe.ninja `name` field.

## Backend endpoints

All JSON, `Access-Control-Allow-Origin: *` like heist, same error-handling style
(4xx for bad input, 5xx + `{error}` body for upstream/fetch failures).

- `GET /api/leagues` — proxy to pathofexile.com trade API league list. Identical to heist.
- `GET /api/cache-status?league=` — identical to heist, checks price cache freshness without fetching.
- `GET /api/prices?league=` — fetches/caches poe.ninja Unique{Weapon,Armour,Accessory}
  data for the league (parallel fetch of the 3 categories, 1h TTL cache), returns
  `{ timestamp, items, errors, fromCache }` where each item carries `name`,
  `chaosValue` (min across variants), `_category`.
- `GET /api/items` — returns all rows from the `items` table (`SELECT * FROM items`).
  Public, no auth.
- `POST /api/admin/login` — body `{ "password": "..." }`. Compares against
  `ADMIN_PASSWORD` env var. On success, generates a random session token, stores
  it server-side in an in-memory `Map<token, expiresAt>` (24h expiry), and sets
  it as an `HttpOnly` cookie. Wrong password → `401`.
- `POST /api/admin/logout` — clears the session (removes from the map, clears cookie).
- `PUT /api/admin/items/:name` — requires a valid session cookie (`401` if
  missing/expired). Body is a partial object with any of the six `dust*` columns;
  executes a parameterized `UPDATE items SET ... WHERE name = ?`. `404` if no
  row matches `:name` (checked via the statement's affected-row count).
- Static file serving for everything else, same as heist.

Session validation: a small helper reads the cookie, looks it up in the in-memory
map, and checks `expiresAt > Date.now()`. Restarting the server invalidates all
sessions (single-admin tool, acceptable — matches heist's philosophy of avoiding
external dependencies over robustness for edge cases that don't matter here).

## Frontend

Single `index.html`, styled consistently with heist's existing look (same warm
parchment palette, fonts, button/input styles) but laid out as a **table**, not
a card grid — the README's own description ("tabulka") and the density of 9
numeric columns make a table the right fit, unlike heist's replica cards.

**Header controls** (same row style as heist): league input + Load button with
the same 1-hour rate-limit-disable behavior as heist (button shows countdown,
re-enables after cache TTL elapses).

**Filter bar**: name search (reused pattern from heist), min/max chaos range
(two number inputs — heist only has min, this adds max), type filter buttons
(All / Weapon / Armour / Jewellery, same active/count-badge behavior as heist's
type buttons).

**Table columns**: `Name | Type | Price (chaos) | 83 | 83+20 | c/dust(83) | 84 |
84+20 | c/dust(84) | 85 | 85+20 | c/dust(85)`. Each ilvl group's efficiency
column is computed as `dust / chaosValue` (higher = more efficient), rendered
`—` when the underlying dust value is `null`. Column headers are clickable to
sort ascending/descending by that column (replaces heist's single sort
dropdown, since there are now 9 sortable numeric columns instead of one price).

**Admin mode**: a "Login" control (top-right, mirroring heist's external
site-link slot) opens a small password prompt inline (not a full page). On
successful login, all six dust cells per row become editable in place
(click-to-edit, Enter/blur to save via `PUT /api/admin/items/:name`, optimistic
UI update, revert on error). A "Logout" control replaces "Login" once
authenticated. Logged-out users see the same table fully populated but
read-only.

## Local development / deployment

Identical pattern to heist:
- `Dockerfile`: `FROM node:22-alpine`, copy `server.js`, `index.html`,
  `CMD ["node", "server.js"]`. `data/` is bind-mounted, not copied in, so the
  live database isn't baked into the image.
- `docker-compose.yml`: bind-mount the project directory, `node server.js`,
  expose a port (`3001`, to avoid colliding with heist's `3000` if both run
  locally at once), `restart: "no"`.
- `package.json`: `{ "main": "server.js", "scripts": { "start": "node server.js" } }`,
  zero dependencies. If the `node:22-alpine` image in use turns out to still
  require `--experimental-sqlite` (unflagged status should be verified against
  the actual installed Node version during implementation), that flag is added
  to the `node` invocation in both the Dockerfile `CMD` and the `start` script.
- `data/poe-dust.db` is `.gitignore`d (it's a binary file that changes on every
  admin edit — not meant to be diffed in git, same reasoning heist applies to
  `cache/`). A fresh checkout runs `node scripts/import-items.js` once to
  produce it locally; the bind-mounted volume then makes it persist across
  container restarts on that machine.
- `ADMIN_PASSWORD` supplied via environment variable (e.g. in `docker-compose.yml`
  or a local `.env` sourced by the shell — not committed).

Production deployment (Render) is explicitly **out of scope for this spec** —
in particular, how `data/poe-dust.db` survives redeploys on Render's ephemeral
filesystem is an open question the user deferred to a later iteration. The
local Docker setup does not need to solve this: a bind-mounted volume already
persists the file on the host.

## Out of scope for v1

- Production persistence strategy for `data/poe-dust.db` on Render.
- Live sync from the Google Sheet or the gist at runtime (the import is a
  one-time seed, not an ongoing sync).
- Populating `dust83*`/`dust85*` values (left `null`, admin fills in later).
- Multiple admin accounts / usernames (single shared password only).
- `UniqueJewel` (socketable jewels) and flasks — not part of the dust mechanic per README.
