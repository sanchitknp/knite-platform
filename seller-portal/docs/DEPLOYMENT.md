# Deployment & Operations

> **Secrets are never in git.** The real values (DB password, JWT secret, Google
> key) live only in `seller-portal/.env` **on the VM** (gitignored). This doc
> gives topology and procedure, not credentials.

## Infrastructure (current — dev)

| Thing | Value |
|-------|-------|
| GCP project | `knite-prod-c05f94` |
| VM | `knite-vm`, `asia-south1-c`, static IP **34.93.50.12** |
| Reachable at | `http://34.93.50.12:4000` (plain HTTP — see "HTTPS" below) |
| Firewall rule | `allow-ssp` → `tcp:4000` from `0.0.0.0/0`, target tag `ssp-server` (the VM has this tag) |
| Cloud SQL | `knite-db`, Postgres 15, IP **34.100.254.57**, database **`knite`** |
| DB user | **`ssp`** (LOGIN), owns schema **`ssp_app`**, `search_path = ssp_app, public` |
| Container | `ssp-backend` (compose project **`ssp`**) |
| SSH alias | `knite-vm.asia-south1-c.knite-prod-c05f94` (from `gcloud compute config-ssh`) |
| Repo on VM | `~/knite-platform/` (user `sanchit.agrawal`) |

The VM and Cloud SQL are **shared with Knite**. Knite runs its own containers
(`knite-backend`, `knite-caddy`, `knite-redis`) and owns the `public` schema's
Knite tables. Do not disturb them.

## Environment variables (`seller-portal/.env` on the VM)

Copy `.env.example` → `.env` and fill in. Keys:

| Var | Purpose |
|-----|---------|
| `PORT` | `4000` |
| `DATABASE_URL` | `postgresql://ssp:<pw>@34.100.254.57:5432/knite?sslmode=require` |
| `JWT_SECRET` | long random string, independent of Knite |
| `SSP_COOKIE_SECURE` | `false` on HTTP; set `true` once behind HTTPS |
| `SSP_DATA_DIR` | `/app/data` (safety-claim images, bind-mounted to host) |
| `SSP_SAFETY_RETENTION_DAYS` | `60` |
| `GOOGLE_GEOCODING_KEY` | reused from Knite's `.env` (IP-restricted to the VM); needed only for nearest-technician geocoding |

`docker-compose.portal.yml` loads this via `env_file`. **An env change requires a
container recreate** (`--force-recreate`), not just a nodemon restart, because
`env_file` is read at container start.

## One-time DB setup (already done; here for reproducibility)

Run as the Cloud SQL `postgres` superuser (via a throwaway `psql` container on the
VM, or Cloud Shell). Cloud SQL's `postgres` is **not** a full superuser, so to
create objects owned by `ssp` you must first be a member of the `ssp` role:

```sql
CREATE ROLE ssp LOGIN PASSWORD '<pw>';
GRANT CONNECT ON DATABASE knite TO ssp;
GRANT ssp TO postgres;                       -- else CREATE SCHEMA ... AUTHORIZATION fails
CREATE SCHEMA IF NOT EXISTS ssp_app AUTHORIZATION ssp;
ALTER ROLE ssp SET search_path = ssp_app, public;
-- shared reference tables the portal reads (nearest-technician):
GRANT SELECT ON public.ro_service_leads TO ssp;
GRANT SELECT ON public.india_pincodes  TO ssp;
```

The app also pins `search_path` at connection time
(`db.js` → `options: '-c search_path=ssp_app,public'`), so it does not rely on the
role default.

## Deploying a change

The source is **bind-mounted** into the container and run under `nodemon`, so for
code/UI changes you just copy the file(s) up — no rebuild:

```bash
# from your machine, repo root
NEWHOST=knite-vm.asia-south1-c.knite-prod-c05f94
scp -r seller-portal/src seller-portal/public "$NEWHOST:~/knite-platform/seller-portal/"
# nodemon auto-restarts on any changed .js; static files (html/js/css) serve immediately
```

- **Static files** (`public/*`) are served immediately (no restart).
- **Backend `.js`** → nodemon restarts automatically; watch with
  `sudo docker logs --tail 20 ssp-backend`.
- **DB schema** changes: add idempotent statements to `src/migrate.js`; they run
  on the next restart. (For the `ssp` role they must be things `ssp` can do in
  `ssp_app`; cross-schema grants are done once as `postgres`, see above.)
- **New npm deps or `.env` change** → rebuild / recreate:
  ```bash
  ssh "$NEWHOST" 'cd ~/knite-platform && sudo docker compose -p ssp -f docker-compose.portal.yml up -d --build --force-recreate'
  ```

Always use the **`-p ssp`** project name and the `docker-compose.portal.yml` file,
so you never touch Knite's compose project.

### First-time / full bring-up

```bash
ssh "$NEWHOST" 'cd ~/knite-platform && sudo docker compose -p ssp -f docker-compose.portal.yml up -d --build'
curl -s http://localhost:4000/api/health      # {"status":"ok","db":"connected",...}
```

## Health check

`GET /api/health` → `{"status":"ok","db":"connected","service":"seller-service-portal",...}`

## Gotchas we already hit (don't relearn these)

- **`sslmode=require` in the URL broke TLS.** Newer `pg` treats it as
  `verify-full`, which fails on Cloud SQL's chain ("unable to verify the first
  certificate"). `db.js` strips `sslmode` from the URL and sets
  `ssl:{rejectUnauthorized:false}` itself.
- **`permission denied for schema public`** on migrate → the role's `search_path`
  wasn't applied, so `CREATE TABLE` targeted `public`. Fixed by pinning
  `search_path=ssp_app,public` via the pool `options` (and on the role).
- **`CREATE SCHEMA ... AUTHORIZATION ssp` → "must be member of role ssp"** →
  `GRANT ssp TO postgres;` first (Cloud SQL `postgres` isn't a full superuser).
- **"could not determine data type of parameter $N"** → a parameter was passed to
  a query but never referenced in its SQL text. Reference every bound param.
- **gcloud token expires ~daily.** SSH (key-based) keeps working, but control-plane
  ops (firewall, `gcloud sql ...`) need `gcloud auth login` again.
- **Geolocation needs HTTPS.** The public form's "Use my current location" button
  only works on a secure origin; on HTTP the form hides it and shows the
  paste-a-Google-Maps-link field instead.

## HTTPS (not done yet)

The portal is on plain HTTP. To make it secure + enable the GPS button, serve it
over HTTPS by adding **one additive site-block** to the existing Caddy
(`infra/Caddyfile`) that reverse-proxies a hostname to `ssp-backend:4000` — the
Knite site block stays byte-for-byte the same. Use either a real domain (DNS
A-record → 34.93.50.12) or a free `sslip.io` host (`34-93-50-12.sslip.io`) for an
auto Let's Encrypt cert. Then set `SSP_COOKIE_SECURE=true`.
