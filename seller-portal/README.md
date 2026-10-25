# Seller Service Portal (SSP)

A **multi-tenant SaaS** that lets any e-commerce seller (Amazon / Flipkart first)
manage their post-sales operations: **sales & support tickets, installations
(with nearest-technician dispatch & review requests), listings, safety claims
(Amazon SAFE-T), a product catalog, and team/role management (RBAC)** — plus
public, no-login **request forms** their customers fill in.

It is a **separate product** from Knite. It runs on the **same VM and the same
Cloud SQL database** as Knite, but is fully isolated (its own container, its own
DB user, its own schema) and carries **no "Knite" branding**.

> **Live (dev):** `http://34.93.50.12:4000` (plain HTTP for now — see
> [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the HTTPS plan).

---

## Documentation

| Doc | What's in it |
|-----|--------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it's built, multi-tenancy & isolation, tech stack |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | VM, Cloud SQL, the `ssp` DB user, Docker, how to deploy, env vars, gotchas |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Every `sp_*` table and the shared reference tables it reads |
| [docs/RBAC.md](docs/RBAC.md) | Roles, permissions, and how they're enforced |
| [docs/FEATURES.md](docs/FEATURES.md) | Each module + the public request links, with API endpoints |

## Tech stack

- **Backend:** Node.js 20 + Express (`src/`), `pg` (Postgres), `bcryptjs`, `jsonwebtoken`, `cookie-parser`.
- **Frontend:** a single static vanilla-JS SPA in `public/` (no build step). JSZip via CDN for safety-claim ZIPs.
- **DB:** PostgreSQL (shared Cloud SQL instance). The portal owns the **`ssp_app`** schema; all its tables are prefixed **`sp_`**.
- **Container:** Docker; runs under `nodemon` with the source bind-mounted (edit a file → auto-restart).

## Repo layout

```
seller-portal/
├── README.md                      # this file
├── docs/                          # all the docs above
├── package.json
├── Dockerfile                     # node:20-alpine, runs `npm run dev`
├── .env.example                   # copy to .env (gitignored) and fill in
├── src/
│   ├── server.js                  # Express app, route table, startup (migrate + backfills)
│   ├── db.js                      # pg Pool (SSL + search_path=ssp_app)
│   ├── migrate.js                 # idempotent CREATE TABLE / ALTER for all sp_* tables
│   ├── auth.js                    # JWT cookie, bcrypt, requireAuth (loads live user each request)
│   ├── rbac.js                    # permission catalog + default role templates (static)
│   ├── roles.js                   # DB-backed roles + requirePerm() middleware + cache
│   ├── intake.js                  # per-seller public tokens for the request forms
│   ├── services/geocoder.js       # location resolution for nearest-technician
│   └── controllers/              # authController, teamController, rolesController,
│                                 #   dashboardController, ticketsController,
│                                 #   installationsController, reviewsController,
│                                 #   listingsController, safetyClaimsController,
│                                 #   productsController, publicController
└── public/
    ├── index.html                 # the authenticated SPA shell
    ├── app.js                     # all client logic (views, modals, API calls)
    ├── styles.css
    └── intake.html                # the public (no-login) customer request form
```

`docker-compose.portal.yml` lives at the **repo root** (not in this folder).

## Run it locally

```bash
cd seller-portal
npm install
cp .env.example .env     # then edit .env (see below)
npm run dev              # starts on http://localhost:4000
```

Minimum `.env` for local dev (point it at any Postgres you can reach):

```
PORT=4000
DATABASE_URL=postgresql://ssp:<password>@<host>:5432/knite
JWT_SECRET=<any-long-random-string>
```

`src/migrate.js` runs automatically on boot and creates every `sp_*` table it
needs (idempotent — safe to run against an existing DB). Then open
`http://localhost:4000`, click **Sign up**, and you have a seller account.

> For nearest-technician geocoding and the shared RO technician directory you
> also need `GOOGLE_GEOCODING_KEY` and `SELECT` on `ro_service_leads` — see
> [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Everything else works without them.

## Non-negotiable constraints (please keep these true)

1. **Never touch Knite.** No edits to Knite's containers, `backend/`, `frontend/`,
   `docker-compose.yml`, or `infra/Caddyfile` behaviour. The portal is additive.
2. **Tenant isolation is sacred.** Every data query is scoped by `seller_id`, and
   `seller_id` comes **only** from the authenticated session — never from the
   request body/query. See [docs/RBAC.md](docs/RBAC.md).
3. **No secrets in git.** `.env` and `data/` are gitignored. Keep it that way.
4. **No "Knite" anywhere** in the portal UI. It's a white-label product.
