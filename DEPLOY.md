# DEPLOY.md — News Pulse deployment guide

The agent cannot create cloud accounts or hold your credentials, so this file is
the exact, copy-pasteable runbook to get a **live, cold-openable URL** yourself.
Two deployment shapes are covered — pick one:

- **Shape A (recommended): Render (backend+scraper) + Vercel (frontend).** The
  backend runs on Render as a Docker web service built from `backend/Dockerfile`
  (described by the root `render.yaml`); `vercel.json` drives the frontend build.
- **Shape B: all-Docker on any other container host (Fly.io, Railway).** Uses
  the same `backend/Dockerfile`.

Both shapes use a **Neon serverless Postgres** database — provisioned once,
shared by the backend and scraper. No local SQLite, no persistent-disk
headaches.

---

## 0. Prerequisites

- A git repo with this code pushed to GitHub (Render and Vercel both deploy from
  a connected repo).
- Accounts on [render.com](https://render.com), [vercel.com](https://vercel.com),
  and [neon.tech](https://neon.tech) (all have free tiers).
- Local clones working (i.e. you've run the scraper + backend + frontend locally
  at least once — see README "Quick start").

---

## 1. Provision a Neon database (shared by all shapes)

Both the Node backend and the Python scraper connect to the same hosted Postgres
instance via the `DATABASE_URL` environment variable. Neon's free tier gives you
a pooled connection string with PgBouncer, which handles connection multiplexing
automatically.

1. Go to [neon.tech](https://neon.tech) → **Sign up** (GitHub OAuth is fastest).
2. **Create Project** → choose a name (e.g. `news-pulse`), a region closest to
   your Render region (e.g. `AWS US West (Oregon)`), and the free plan.
3. Once created, click the **Connection Details** button on the dashboard:
   - Copy the **Pooled connection string** (the one with `-pooler` in the host).
     It looks like:
     ```
     postgresql://neondb_owner:xxxxx@ep-abc123.us-east-2.pooler.neon.tech/neondb?sslmode=require
     ```
   - **Important:** use the **pooled** string, not the direct one. The pooled
     endpoint goes through PgBouncer and supports the many short-lived connections
     that `node-postgres` opens. The direct endpoint has a hard cap of ~20
     concurrent connections on the free tier.
4. Save this string somewhere — you'll paste it as `DATABASE_URL` in Render and
   Vercel env vars below.

> **Connection pooling note:** Neon's pooled endpoint uses transaction-mode
> PgBouncer by default. This works fine with `psycopg2` (the scraper uses
> explicit `commit()`/`rollback()` calls) and `pg.Pool` (the backend). If you
> need session-level features (e.g. `SET` statements), use the non-pooled URL
> instead — but you won't hit the conn limit with a single-server deployment.

> **Local development:** copy `.env.example` to `.env` at the project root and
> paste your Neon `DATABASE_URL`. Both `backend/server.js` (via `dotenv`) and
> `scraper/pipeline.py` (via `envload.py`) read this file. Never commit `.env`.

---

## Shape A — Render (backend + scraper) + Vercel (frontend)

### A.1 Push to GitHub

```bash
git init && git add . && git commit -m "News Pulse"
# create an empty repo on github.com first, then:
git remote add origin https://github.com/<you>/news-pulse.git
git push -u origin main
```

### A.2 Backend on Render (web service)

The backend is a **Docker** web service. The image bundles Node, Python and the
scraper, so `/ingest/trigger` can spawn the scraper in the same container. The
root `render.yaml` records these settings.

1. Render dashboard → **New +** → **Web Service** → connect your repo (or
   **New +** → **Blueprint** to create it from `render.yaml`).
2. **Runtime:** Docker · **Branch:** `main` · **Plan:** Free.
3. Under **Build & Deploy**:
   - **Root Directory:** leave empty. The Dockerfile copies `backend/`,
     `scraper/` and `db/`, so the build context must be the repo root.
   - **Dockerfile Path:** `./backend/Dockerfile`
   - **Docker Build Context Directory:** `.`
   - **Build Filters:** none
   - **Auto-Deploy:** Off (deploys are triggered by GitHub Actions, see A.2.1)
   - **Health Check Path:** `/healthz`
4. On the service → **Environment**, set:
   - `DATABASE_URL` = your Neon **pooled** connection string (from §1 step 3)
   - `PGSSLMODE` = `require` (Neon requires TLS; this is the default if omitted)
   - `PG_POOL_MAX` = `10` (optional; cap on node-postgres pool size)

   `PORT` and `PYTHON_BIN` are set in the Dockerfile and don't need to be added.
5. Deploy. When green, open `https://<backend>.onrender.com/healthz` → you should
   see `{"ok":true}`.

> **No persistent disk needed.** With Neon the database lives on Neon's
> infrastructure, not on Render's filesystem. The Render service simply connects
> via `DATABASE_URL`.

#### A.2.1 Automatic deploys (GitHub Actions → Render deploy hook)

`.github/workflows/deploy-render.yml` asks Render to deploy on every push to
`main` that touches `backend/`, `scraper/`, `db/`, `render.yaml` or
`.dockerignore`. Frontend-only pushes don't redeploy the backend. One-time setup:

1. Render → service → **Settings** → **Deploy Hook** → copy the URL. Treat it as
   a secret: anyone who has it can trigger a deploy.
2. GitHub → repo → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**: name `RENDER_DEPLOY_HOOK_URL`, value = the hook URL.
3. Push to `main`. The run appears under the repo's **Actions** tab, and the
   deploy under **Events** on the Render service.

To deploy without a push, open **Actions** → **Deploy backend to Render** →
**Run workflow**.

If you'd rather use Render's built-in trigger, set **Auto-Deploy** to
**On Commit** and delete the workflow; keeping both starts two deploys per push.
If pushes then start nothing, check that Render's GitHub App has access to this
repository (GitHub → **Settings** → **Applications** → **Render** → **Repository
access**) and that the Root Directory and Build Filters are empty.

### A.3 Frontend on Vercel

1. Vercel dashboard → **Add New** → **Project** → import the same repo.
2. **Root Directory:** `frontend` (Vercel will detect Next.js).
3. **Environment Variables** (Production + Preview):
   - `NEXT_PUBLIC_API_URL` = `https://<backend>.onrender.com` (no trailing slash)
   - `NEXT_PUBLIC_ prefix is required` — without it the value isn't inlined into
     the browser bundle and the UI can't find the API.
4. **Deploy.** `vercel.json` handles the rest (framework=nextjs, build=npm run
   build).
5. Cold-open `https://<frontend>.vercel.app` in an incognito window. Click
   **Refresh data**, watch the spinner, and the timeline should populate within a
   few seconds.

#### CLI alternative

```bash
cd frontend
npm i -g vercel
vercel login
vercel --prod          # follow prompts; set NEXT_PUBLIC_API_URL when asked
```

### A.5 Verify the full loop

```bash
# from your laptop
curl https://<backend>.onrender.com/healthz                 # {"ok":true}
curl https://<backend>.onrender.com/ingest/trigger -X POST  # {"jobId":"…"}
# wait ~30-60s, then:
curl https://<backend>.onrender.com/timeline | head -c 400  # [...clusters...]
```

Then open the Vercel URL → click **Refresh data** → cluster bars appear.

---

## Shape B — All-Docker on another host

Use this to run the same container somewhere other than Render. The container
connects to the same remote Neon database — no local DB file needed.

1. Push to GitHub (A.1).
2. Provision your Neon database (§1).
3. On Railway/Fly.io create a service from `backend/Dockerfile` with the **repo
   root as build context**. The image bundles Node + Python + scraper deps.
4. Set env:
   - `PORT` = `4000`
   - `DATABASE_URL` = your Neon pooled connection string
   - `PGSSLMODE` = `require`
   - `PYTHON_BIN` = `/scraper/.venv/bin/python` (set in Dockerfile)
5. Deploy. `/ingest/trigger` spawns the bundled scraper in-place — same process,
   same Neon connection.
6. Frontend on Vercel as in A.4, pointing `NEXT_PUBLIC_API_URL` at the container
   URL.

```bash
# local docker sanity check (requires DATABASE_URL in your environment)
docker build -f backend/Dockerfile -t news-pulse-backend .
docker run -p 4000:4000 \
  -e DATABASE_URL="postgresql://user:pass@ep-xyz.pooler.neon.tech/neondb?sslmode=require" \
  news-pulse-backend
curl http://localhost:4000/healthz
```

---

## Environment-variable checklist (per service)

| Service  | Var                   | Example value                                                 |
| -------- | --------------------- | ------------------------------------------------------------- |
| backend  | `PORT`                | `4000` (set in the Dockerfile)                                |
| backend  | `DATABASE_URL`        | `postgresql://neondb_owner:xxx@ep-xyz.pooler.neon.tech/...`   |
| backend  | `PYTHON_BIN`          | `/scraper/.venv/bin/python` (set in the Dockerfile)           |
| backend  | `PGSSLMODE`           | `require` (default; set `disable` for local non-TLS Postgres) |
| backend  | `PG_POOL_MAX`         | `10` (optional; node-postgres pool cap)                       |
| scraper  | `DATABASE_URL`        | **must be the same Neon connection string as backend**        |
| scraper  | `CLUSTER_THRESHOLD`   | `3` (optional; small-corpus link threshold)                   |
| frontend | `NEXT_PUBLIC_API_URL` | `https://<backend>.onrender.com`                              |

---
