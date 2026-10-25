# Data Model

All portal tables live in the **`ssp_app`** schema, are prefixed **`sp_`**, and
are created/altered idempotently by [`src/migrate.js`](../src/migrate.js) on boot.
Every tenant table has a `seller_id` FK → `sp_sellers(id)` with
`ON DELETE CASCADE`. `id`s are `uuid` (`gen_random_uuid()`) unless noted.

## Tenancy & auth

### `sp_sellers` — the tenant
`business_name`, `contact_name`, `email` (unique), `phone`, `status`
(`active`|`suspended`), `plan`, **`public_token`** (unguessable token for the
public request-form URLs), `created_at`, `updated_at`.

### `sp_users` — login accounts (belong to a seller)
`seller_id`, `name`, `email` (unique), `password_hash` (bcrypt), **`role`**
(a key into `sp_roles`), `status` (`active`|`disabled`), `last_login_at`,
`created_by`, `created_at`.

### `sp_roles` — per-seller roles (RBAC) — see [RBAC.md](RBAC.md)
`seller_id`, `key` (slug, referenced by `sp_users.role`), `name`,
`permissions text[]`, `is_system` (built-in defaults can't be deleted),
`created_at`, `updated_at`. `UNIQUE(seller_id, key)`.

### `sp_seller_marketplaces`
`seller_id`, `marketplace` (`amazon`|`flipkart`), `external_seller_id`,
`display_name`, `status`. `UNIQUE(seller_id, marketplace, external_seller_id)`.

### `sp_audit_log`
`seller_id`, `user_id`, `action`, `entity`, `entity_id`, `meta jsonb`,
`created_at`. (Scaffolding for later use.)

## Module: Sales & Support

### `sp_support_tickets`
`seller_id`, `marketplace`, `order_id`, `customer_name`, `customer_contact`,
`customer_email`, `city`, `pincode`, `channel`, `category`, `subject`,
`description`, `priority` (`low|normal|high|urgent`), `status`
(`open|in_progress|waiting|resolved|closed`), `assigned_to` (→ `sp_users`),
`source` (`portal`|`public`), timestamps, `resolved_at`.

### `sp_ticket_messages`
`ticket_id`, `seller_id`, `author_type` (`seller|customer|system`), `author_id`,
`body`, `created_at`. (Thread on a ticket.)

### `sp_installations`
The installation request / job. From the public form (`source='public'`) or staff.
Columns: `seller_id`, `customer_name`, `customer_phone`, `customer_email`,
`address`, `city`, `pincode`, **`latitude`/`longitude`/`geo_source`**,
**`maps_link`**, `product_name`, `product_sku`, **`purchased_from`**,
`marketplace`, `order_id`, `serial_no`, `status`
(`pending|scheduled|installed|cancelled`), `preferred_date`, `preferred_slot`,
`notes`, `source`, **`assigned_tech_name`/`assigned_tech_phone`/`assigned_at`**
(denormalized current assignment), **`review_requested_at`**, timestamps.

### `sp_installation_assignments` — dispatch history
`installation_id`, `seller_id`, `tech_name`, `tech_phone`, `tech_source`
(`directory|custom|manual`), `place_id` (ro_service_leads ref when from the
directory), `distance_km`, `assigned_by`, `status`, `assigned_at`. Latest row per
installation = current assignment (also mirrored onto `sp_installations`).

### `sp_technicians` — per-seller custom technician roster
`seller_id`, `name`, `phone`, `city`, `address`, `latitude`, `longitude`,
`active`, `created_at`. `UNIQUE(seller_id, phone)`. Nearest-technician searches
this **plus** the shared RO directory.

### `sp_reviews` — (currently unused by the UI)
`seller_id`, `installation_id`, `product_name`, `marketplace`, `order_id`,
`rating`, `title`, `body`, `reviewer_name`, `reply`, `status`, timestamps.
> The live review feature is **"Send review request"** (WhatsApp), which lives on
> `sp_installations.review_requested_at` + `sp_products.review_link`, **not** this
> table. `sp_reviews` + its controller/routes remain for a possible future
> marketplace-review sync. See [FEATURES.md](FEATURES.md#reviews).

## Module: Listings

### `sp_listings`
`seller_id`, `marketplace`, `sku`, `marketplace_id` (ASIN/FSN), `title`, `brand`,
`category`, `mrp`, `selling_price`, `stock`, `status`
(`active|inactive|suppressed|draft`), `buybox_status`, `last_synced_at`,
`extra jsonb`, timestamps. `UNIQUE(seller_id, marketplace, marketplace_id)`.

### `sp_listing_issues`
`listing_id`, `seller_id`, `issue_type`, `detail`, `status`, `created_at`.

## Module: Safety Claims (Amazon SAFE-T)

### `sp_safety_claims`
`seller_id`, `marketplace` (default `amazon`), `order_id`, `reason`,
`amount_claimed`, `status` (`pending|filed|approved|rejected|closed`),
`image_count`, `images_expired`, `notes`, `filed_at`, `resolution`, `created_by`,
timestamps. `UNIQUE(seller_id, order_id)`. Images are stored on the VM disk at
`SSP_DATA_DIR/safety-claims/<seller_id>/<order_id>/` (bind-mounted), retained
`SSP_SAFETY_RETENTION_DAYS` days (daily cron cleanup).

## Product catalog

### `sp_products`
`seller_id`, `name`, `sku`, **`review_link`** (the product's Amazon/Flipkart review
URL, used by "Send review request"), `active`, `created_at`.
`UNIQUE(seller_id, name)`. Populates the Product dropdown on the request forms.

## Geocoding cache

### `sp_pincode_geo`
`pincode` (PK), `lat`, `lng`, `source`, `created_at`. Lazily filled from Google
geocoding so repeat pincodes resolve for free.

## Shared reference tables (read-only; owned by Knite in `public`)

The `ssp` user has **`SELECT`** on these; the portal never writes them.

- **`ro_service_leads`** — ~14,900 RO service technicians scraped from Google
  (cols incl. `business_name`, `phone`, `latitude`, `longitude`, `rating`,
  `city`, `pincode`, `place_id`, `google_maps_link`). Used as the shared
  technician pool for nearest-technician.
- **`india_pincodes`** — pincode → area/district/city/state. **No lat/lng**
  (don't use it for coordinates; geocode instead).
