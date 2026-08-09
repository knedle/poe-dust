# Deploying poe-dust to Render

This mirrors how `E:\docker\heist` is deployed (https://poe1-heist-replica-prices.onrender.com/,
repo https://github.com/knedle/heist) — same free tier, same auto-deploy-on-push setup.
It works on Render's **free tier with no persistent disk**, because `server.js`
re-seeds `data/poe-dust.db` from `scripts/seed.csv` on every boot — nothing on
disk needs to survive a restart or redeploy (see `CLAUDE.md`'s Architecture
section for why).

GitHub repo (already created and pushed): https://github.com/knedle/poe-dust

## Steps

1. Go to https://dashboard.render.com and log in.
2. Click **New +** → **Web Service**.
3. Connect your GitHub account if this is the first Render deploy from it,
   then pick the **knedle/poe-dust** repository. Grant Render access to it if asked.
4. Fill in the service settings:
   - **Name**: `poe-dust` (or anything you like — it becomes part of the
     `*.onrender.com` URL)
   - **Branch**: `main`
   - **Root Directory**: leave empty (repo root)
   - **Runtime/Environment**: **Docker** — Render should auto-detect the
     `Dockerfile` at the repo root and select this automatically. If it
     doesn't, pick it manually from the environment dropdown.
   - **Instance Type**: **Free**
5. No environment variables are required. In particular, do not set `PORT` —
   Render injects its own `PORT` value automatically, and `server.js` already
   reads `process.env.PORT` (falling back to `3001` only when unset, which
   won't happen on Render).
6. Leave **Health Check Path** at its default (or set it to `/` — either is fine).
7. Click **Create Web Service**. Render clones the repo, builds the
   `Dockerfile`, and starts the container. First build takes a few minutes.
8. Once the deploy log shows `poe-dust running on http://localhost:<port>`,
   open the `https://<name>.onrender.com` URL Render shows you. Confirm `/`
   loads the table and (after clicking **Load**) shows items with prices.

## Notes

- **Auto-deploy**: enabled by default — every push to `main` triggers a new
  build and deploy, same as heist.
- **Free tier cold starts**: the service spins down after ~15 minutes with no
  traffic and takes ~30–50 seconds to wake up on the next request. This is
  expected and fine for this app — the boot-time reseed means a cold start
  never serves stale or missing data.
- **poe.ninja/PoE trade API price cache** (`cache/*.json`) is also rebuilt
  on demand and doesn't need to survive restarts, same as `data/`.
- There's no admin login or write path anymore — the app is read-only. If
  dust values are ever wrong, fix them upstream (see `CLAUDE.md`'s Data
  source note), not in the app.
