# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Path of Exile unique-item "dust" tracker: shows disenchant dust yield at
item level 84 (base and +20% quality) next to each item's current poe.ninja
chaos price and a dust-per-chaos efficiency ratio. Modeled on
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

Set `ADMIN_PASSWORD` (env var) to enable admin login (`/admin`) for editing
dust values in the UI. `docker-compose.yml` sets it to `changeme` for local
dev. Admin edits are **session-scoped, not persistent** — see Architecture
below; there's no data to lose by restarting.

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
- `public/index.html` — self-contained SPA (inline CSS/JS, no build step). Fetches
  `/api/items` (dust data) and `/api/prices` (live prices) separately and joins
  them client-side by item name; items with no price match are hidden.
- `public/admin.html` — standalone login page, served at `GET /admin`, posts to
  `/api/admin/login` and redirects to `/` on success.
- `scripts/import-items.js` + `scripts/seed.csv` — seeds `data/poe-dust.db`
  from a community-sourced dust-value dataset. **Runs automatically on every
  server boot** (see `server.js`'s `require.main === module` block) — this is
  deliberate, not just a leftover one-time-setup script: `data/poe-dust.db` is
  treated as a rebuildable cache of `scripts/seed.csv`, the same way heist
  treats `cache/*.json` as a rebuildable cache of poe.ninja. Each boot fully
  overwrites `dust84`, `dust84q20`, `slots`, and `subtype` for every item in
  `seed.csv` (`type` always goes back to `NULL` — it's never in the CSV) via
  `insertItem`'s upsert. It does NOT remove rows for items that existed in a
  previous `seed.csv` but are absent from the current one (a stale row has to
  be deleted manually — see the 2026-08-09 cleanup that dropped 18 leftover
  Legion "Piece of ..." fragments after switching data sources).

  **Consequence: admin edits (`PUT /api/admin/items/:name`) are session-scoped
  only.** They persist in the running `data/poe-dust.db` until the next
  restart/redeploy, at which point the boot-time reseed silently overwrites
  them. This is an accepted tradeoff (confirmed 2026-08-09), not a bug — it's
  what lets this app run on a platform with an ephemeral filesystem (e.g.
  Render's free tier) with zero persistence setup. If a real need for durable
  admin edits ever comes back, this tradeoff needs revisiting (real DB +
  persistent disk, or an external store) — don't "fix" it by just skipping
  the reseed, since then a fresh deploy would start from an empty/stale DB.

  **Data source:** `scripts/seed.csv` is currently derived from
  https://github.com/deronek/poe-disenchant-tool/tree/main/data/dust (`poe-dust.js`) —
  check that repo periodically for updates (if it's still maintained) and regenerate
  `seed.csv` from it when the numbers drift, since it's more accurate than the original
  Google Sheet/gist source this project started with (e.g. it uses a per-item quality
  multiplier instead of a flat +20%, and excludes non-disenchantable fragment items).

## Key details

- `data/` and `cache/` are both `.gitignore`d and fully disposable — both get
  rebuilt from scratch on every server start (`data/` from `scripts/seed.csv`,
  `cache/` from poe.ninja on demand). Nothing on disk needs to survive a
  restart, which is why this app can run on Render's free tier (no persistent
  disk) the same way heist does.
