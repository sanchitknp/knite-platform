# Features & API

Permissions in brackets are the `requirePerm(...)` gate (see [RBAC.md](RBAC.md)).
All authenticated endpoints are under `/api` (after `requireAuth`) and scoped to
the caller's `seller_id`. Public endpoints need no login.

## Auth & session
- `POST /api/auth/signup` — creates the seller (tenant) + its first user (Owner),
  seeds default roles, and issues a public token. *(public)*
- `POST /api/auth/login`, `POST /api/auth/logout` *(public)*
- `GET /api/auth/me` — current user + business + resolved `permissions[]`.

## Dashboard
- `GET /api/dashboard` — seller-scoped counts: open tickets, active/suppressed
  listings, pending/filed safety claims, pending/installed installations.

## Public request links (customer-facing, NO login)

Every seller has an unguessable `public_token`. Two shareable URLs:

- `…/r/<token>/install` → installation request form
- `…/r/<token>/support` → support request form

Served by `public/intake.html`. The seller gets these from the **🔗 Request links**
button in the top bar (every page, every role) or in **Settings**.

Backing endpoints *(public, token-scoped, honeypot + per-IP rate limit)*:
- `GET /api/public/:token` — validates the link, returns the business name.
- `GET /api/public/:token/products` — active products for the Product dropdown.
- `POST /api/public/:token/support` — creates a ticket (`source='public'`).
- `POST /api/public/:token/install` — creates an installation (`source='public'`).

Seller-side:
- `GET /api/intake-links` — the seller's token *(any logged-in user)*.
- `POST /api/intake-links/regenerate` *(`settings.manage`)* — new token, old links die.

The **installation form** captures the full Knite field set: name, mobile, email,
product (dropdown from the catalog + "Other"), where-bought, order id, address,
city, pincode, **Google Maps link** (+ "use my current location" on HTTPS), notes.
The **support form**: name, mobile, email, subject, category, order id, city,
pincode, description.

## Sales & Support (tabbed: Tickets | Installations)

### Tickets
- `GET /api/tickets` *(support.read)* — list + filters.
- `POST /api/tickets` *(support.write)* — create.
- `GET /api/tickets/:id` *(support.read)* — ticket + message thread.
- `PATCH /api/tickets/:id` *(support.write)* — status/priority/category.
- `POST /api/tickets/:id/messages` *(support.write)* — add a note/reply.

### Installations + service suite
- `GET /api/installations` *(installations.read)* — list + filters (incl. the
  product's `review_link` via a join, and the current assigned tech).
- `POST /api/installations` *(installations.write)* — staff creates one.
- `PATCH /api/installations/:id` *(installations.write)* — status/notes/schedule.
- **`GET /api/installations/:id/nearest-technicians`** *(installations.read)* —
  resolves the job's location (GPS pin → pincode cache → Google geocode) and
  returns the nearest technicians from the shared RO directory + the seller's
  roster, sorted by distance (Haversine).
- **`POST /api/installations/:id/assign`** *(installations.write)* — assign a
  technician (from the list or manual); records history in
  `sp_installation_assignments`, mirrors the current tech onto the installation,
  and moves `pending → scheduled`. The UI offers a `wa.me` link to the tech.

### Reviews  {#reviews}
**It is "Send review request", not manual review entry** (matches the Knite flow).
- **`POST /api/installations/:id/review-request`** *(installations.write)* — stamps
  `review_requested_at`. The button opens **WhatsApp** (`wa.me`) to the customer
  with a prefilled message including the product's **`review_link`**
  (set per product in the catalog). Built client-side so `window.open` isn't
  popup-blocked; stamping is a follow-up call.
- There is **no** "add review" UI. (`sp_reviews` + `reviewsController` still exist,
  unused, for a possible future marketplace-review sync.)

## Products (catalog)
Populates the Product dropdown on the forms; each product can carry a review link.
- `GET /api/products` *(any logged-in user — staff need it to pick a product)*
- `POST /api/products` *(settings.manage)* — `{name, sku?, review_link?}`
- `PATCH /api/products/:id` *(settings.manage)* — name/sku/review_link/active
- `DELETE /api/products/:id` *(settings.manage)*

## Listings
- `GET /api/listings` *(listings.read)*, `POST` *(listings.write)*,
  `PATCH /api/listings/:id` *(listings.write)*, `DELETE /api/listings/:id`
  *(listings.write)*. Manual CRUD now; marketplace API sync is future work.

## Safety Claims (Amazon SAFE-T)
Reused from Knite's proven engine, made per-seller. Images on VM disk, 60-day
retention, ZIP download (`<order>-1.jpg`…), SAFE-T deep link.
- `GET /api/safety-claims` *(safety.read)*, `POST` *(safety.write)*
- `POST /api/safety-claims/:orderId/images` *(safety.write)* — base64 upload
- `GET /api/safety-claims/:orderId/images` *(safety.read)*,
  `GET /api/safety-claims/:orderId/image/:name` *(safety.read)*
- `POST /api/safety-claims/:orderId/file` *(safety.write)* — mark filed
- `PATCH /api/safety-claims/:orderId` *(safety.write)* — rename order id
- `DELETE /api/safety-claims/:orderId` *(safety.write)*

## Settings *(settings.manage)*
- Public request links (view + regenerate).
- Marketplace accounts: `GET/POST /api/marketplaces`.
- (Products are their own nav page.)

## Roadmap / not built yet
- **HTTPS** (domain or sslip.io + Caddy) — also enables the GPS button.
- **Marketplace API sync** (Amazon SP-API / Flipkart) for listings, orders, reviews.
- **Automated WhatsApp dispatch** to technicians (currently a `wa.me` click).
- SLA timers; the `sp_audit_log` and `sp_reviews` tables are scaffolding for later.
