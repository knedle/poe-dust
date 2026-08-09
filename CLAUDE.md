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
  `dust84`, `dust84q20`, `slots`, `type`, `subtype`). ilvl 83/85 columns were
  dropped (2026-08-09) — the data source only reliably covers ilvl 84.
- `lib/auth.js` — single-shared-password admin sessions (in-memory token map,
  24h TTL, `HttpOnly` cookie).
- `lib/priceCache.js` — 1-hour file cache for poe.ninja responses (`cache/<league>.json`).
- `lib/poeNinja.js` — poe.ninja HTTP client; fetches `UniqueWeapon`/`UniqueArmour`/
  `UniqueAccessory`, collapses link-count variants to the cheapest `chaosValue` per name.
- `index.html` — self-contained SPA (inline CSS/JS, no build step). Fetches
  `/api/items` (dust data) and `/api/prices` (live prices) separately and joins
  them client-side by item name; items with no price match are hidden.
- `scripts/import-items.js` + `scripts/seed.csv` — one-time seed of `data/poe-dust.db`
  from a community-sourced dust-value dataset. Re-running it is a full, destructive
  rebuild: it overwrites `dust84`, `dust84q20`, `slots`, `type`, and `subtype` for
  every item in `seed.csv` (only `dust84`/`dust84q20`/`slots`/`subtype` actually get
  a value from the CSV — `type` goes back to `NULL`), even if an admin had already
  filled it in. It also does NOT remove rows for items
  that existed in a previous `seed.csv` but are absent from the current one (a stale
  row has to be deleted manually — see the 2026-08-09 cleanup that dropped 18 leftover
  Legion "Piece of ..." fragments after switching data sources). Only re-run it if you
  intend to discard existing admin edits and start over from the seed data.

  **Data source:** `scripts/seed.csv` is currently derived from
  https://github.com/deronek/poe-disenchant-tool/tree/main/data/dust (`poe-dust.js`) —
  check that repo periodically for updates (if it's still maintained) and regenerate
  `seed.csv` from it when the numbers drift, since it's more accurate than the original
  Google Sheet/gist source this project started with (e.g. it uses a per-item quality
  multiplier instead of a flat +20%, and excludes non-disenchantable fragment items).

## Key details

- `data/` and `cache/` are both `.gitignore`d. `data/poe-dust.db` must exist
  locally before the server has anything to show — run `node scripts/import-items.js`
  once after cloning.
- Production deployment (Render) and how `data/poe-dust.db` persists there is
  an open question, deliberately out of scope so far — see the design spec's
  "Out of scope" section.
