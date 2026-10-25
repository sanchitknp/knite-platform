# Architecture

## The one-paragraph version

The Seller Service Portal is a standalone Node/Express app serving a vanilla-JS
SPA. It runs in its **own Docker container** (`ssp-backend`) on the **same GCP VM**
as Knite, and talks to the **same Cloud SQL Postgres instance** as Knite — but as
a **dedicated, least-privilege DB user (`ssp`)** that owns its **own schema
(`ssp_app`)**. Knite and the portal share nothing at runtime except the host and
the database server. Every row the portal stores belongs to a **seller (tenant)**,
and every query is scoped by `seller_id`.

```
                         GCP VM  (34.93.50.12, asia-south1-c)
  ┌─────────────────────────────────────────────────────────────┐
  │  knite-caddy ─┬─ :443 knite.in ─────────► knite-backend :3000 │   (Knite — untouched)
  │               └─ :80  (ACME/redirect)                         │
  │                                                               │
  │  ssp-backend :4000  ◄───── firewall allow-ssp (tcp:4000) ◄─── internet
  │     (compose project "ssp", docker-compose.portal.yml)        │
  └───────────────────────────�────────────────────────────────── ┘
                              │  (both connect to the same DB server)
                              ▼
                 Cloud SQL  (knite-db, 34.100.254.57, Postgres 15)
                 database "knite":
                   • public schema      → Knite's tables (owned by knite)
                                          + shared reference tables (ro_service_leads, india_pincodes)
                   • ssp_app schema      → the portal's sp_* tables (owned by ssp)
```

## Why this shape

- **Same VM + DB, zero Knite risk.** The portal is a *separate compose project*
  (`-p ssp`) with its own container, port, DB user and schema. You can build,
  restart, or roll it back without any effect on Knite. The brief was explicit:
  *do not change the Knite website.*
- **Multi-tenant from day one.** Retro-fitting tenancy is painful, so `seller_id`
  is on every tenant table and enforced server-side everywhere (see below).

## Multi-tenancy & isolation (the important part)

Three layers, outermost to innermost:

1. **DB user / schema.** The app connects as `ssp`, which owns only `ssp_app`
   and has `SELECT` on two shared reference tables. It cannot write Knite's data.
2. **Auth identifies the tenant.** On login we set a JWT in an **httpOnly cookie**
   carrying the user id. `requireAuth` (in `src/auth.js`) **loads the live user row
   from the DB on every request** (not just trusting the token) and sets
   `req.auth = { user_id, seller_id, role, email }`. Loading live means a disabled
   user or a changed role takes effect immediately, not at token expiry.
3. **Every query is scoped.** Controllers always filter `WHERE seller_id = req.auth.seller_id`.
   **`seller_id` is taken only from `req.auth`** — never from the request body,
   query string, or URL. This is the rule that keeps tenants from seeing each
   other's data; it was verified with a two-seller isolation test (seller B gets
   `[]` / `404` / `401` for seller A's data).

## Request lifecycle

```
Browser (cookie) ──► Express
   │  app.use(cors, morgan, cookieParser, express.json 20mb)
   │  public routes:    /api/auth/*, /api/public/:token/*   (NO auth)
   │  app.use('/api', requireAuth)                          ◄── everything below needs login
   │     requirePerm('<perm>')  per route                   ◄── RBAC gate (see RBAC.md)
   │        controller → db (scoped by seller_id) → JSON
   └─ static: express.static(public/) ; /r/:token → intake.html ; * → index.html (SPA)
```

Route ordering matters: the public (`/api/public/...`) and auth
(`/api/auth/...`) routes are registered **before** `app.use('/api', requireAuth)`,
and the SPA catch-all (`* → index.html`) is registered **last**, after the
`/r/:token` public-form route and `express.static`.

## Boot sequence (`src/server.js`)

On startup the app runs, in order:
1. `migrate()` — idempotent `CREATE TABLE IF NOT EXISTS` / `ALTER ... ADD COLUMN
   IF NOT EXISTS` for all `sp_*` tables (never touches non-`sp_` tables).
2. `roles.backfillRoles()` — seeds the 5 default roles for any seller missing them.
3. `intake.backfillTokens()` — gives a public token to any seller missing one.
4. `app.listen(4000)` and a daily cron for safety-claim image retention.

## Frontend

A single static SPA (`public/index.html` + `app.js` + `styles.css`), no build
step. `app.js` keeps a `ME` object (from `/api/auth/me`, includes the user's
resolved `permissions`), a `can(perm)` helper that shows/hides UI, a tiny
`api()` fetch wrapper (a `401` bounces to the login view), and one `VIEWS[...]`
function per screen. The public customer form is a **separate** page
(`public/intake.html`) so it never loads the authenticated app.

See [DATA-MODEL.md](DATA-MODEL.md), [RBAC.md](RBAC.md), [FEATURES.md](FEATURES.md),
[DEPLOYMENT.md](DEPLOYMENT.md).
