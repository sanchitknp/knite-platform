// Idempotent schema setup for the Seller Service Portal.
// Creates ONLY `sp_*` tables in the shared `knite` database. It never touches
// any existing Knite table. Safe to run on every boot.
const db = require('./db');

const SQL = `
-- ── Tenancy / auth ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sp_sellers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  contact_name  TEXT,
  email         TEXT UNIQUE NOT NULL,
  phone         TEXT,
  status        TEXT NOT NULL DEFAULT 'active',   -- active | suspended
  plan          TEXT NOT NULL DEFAULT 'free',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sp_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     UUID NOT NULL REFERENCES sp_sellers(id) ON DELETE CASCADE,
  name          TEXT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'owner',    -- owner | staff
  status        TEXT NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sp_users_seller ON sp_users(seller_id);
ALTER TABLE sp_users ADD COLUMN IF NOT EXISTS created_by UUID;

-- Per-seller roles (RBAC). The "key" column is the slug referenced by sp_users.role.
CREATE TABLE IF NOT EXISTS sp_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   UUID NOT NULL REFERENCES sp_sellers(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, key)
);
CREATE INDEX IF NOT EXISTS idx_sp_roles_seller ON sp_roles(seller_id);

CREATE TABLE IF NOT EXISTS sp_seller_marketplaces (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id          UUID NOT NULL REFERENCES sp_sellers(id) ON DELETE CASCADE,
  marketplace        TEXT NOT NULL,                -- amazon | flipkart
  external_seller_id TEXT,
  display_name       TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, marketplace, external_seller_id)
);
CREATE INDEX IF NOT EXISTS idx_sp_mkt_seller ON sp_seller_marketplaces(seller_id);

CREATE TABLE IF NOT EXISTS sp_audit_log (
  id         BIGSERIAL PRIMARY KEY,
  seller_id  UUID,
  user_id    UUID,
  action     TEXT,
  entity     TEXT,
  entity_id  TEXT,
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sp_audit_seller ON sp_audit_log(seller_id, created_at DESC);

-- ── Module A: Sales & Support ────────────────────────────────
CREATE TABLE IF NOT EXISTS sp_support_tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id        UUID NOT NULL REFERENCES sp_sellers(id) ON DELETE CASCADE,
  marketplace      TEXT,
  order_id         TEXT,
  customer_name    TEXT,
  customer_contact TEXT,
  channel          TEXT,                            -- email|call|chat|marketplace
  category         TEXT,                            -- return|refund|replacement|complaint|query|other
  subject          TEXT NOT NULL,
  description      TEXT,
  priority         TEXT NOT NULL DEFAULT 'normal',  -- low|normal|high|urgent
  status           TEXT NOT NULL DEFAULT 'open',    -- open|in_progress|waiting|resolved|closed
  assigned_to      UUID REFERENCES sp_users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sp_tickets_seller ON sp_support_tickets(seller_id, status, created_at DESC);
ALTER TABLE sp_support_tickets ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'portal';
ALTER TABLE sp_support_tickets ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE sp_support_tickets ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE sp_support_tickets ADD COLUMN IF NOT EXISTS pincode TEXT;

CREATE TABLE IF NOT EXISTS sp_ticket_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES sp_support_tickets(id) ON DELETE CASCADE,
  seller_id   UUID NOT NULL REFERENCES sp_sellers(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL DEFAULT 'seller',       -- seller|customer|system
  author_id   UUID,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sp_tmsg_ticket ON sp_ticket_messages(ticket_id, created_at);

-- ── Module B: Listing ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sp_listings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id      UUID NOT NULL REFERENCES sp_sellers(id) ON DELETE CASCADE,
  marketplace    TEXT NOT NULL,                     -- amazon|flipkart
  sku            TEXT,
  marketplace_id TEXT,                              -- ASIN (amazon) / FSN (flipkart)
  title          TEXT,
  brand          TEXT,
  category       TEXT,
  mrp            NUMERIC,
  selling_price  NUMERIC,
  stock          INTEGER,
  status         TEXT NOT NULL DEFAULT 'active',    -- active|inactive|suppressed|draft
  buybox_status  TEXT,
  last_synced_at TIMESTAMPTZ,
  extra          JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, marketplace, marketplace_id)
);
CREATE INDEX IF NOT EXISTS idx_sp_listings_seller ON sp_listings(seller_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS sp_listing_issues (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES sp_listings(id) ON DELETE CASCADE,
  seller_id  UUID NOT NULL REFERENCES sp_sellers(id) ON DELETE CASCADE,
  issue_type TEXT,
  detail     TEXT,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sp_listing_issues_seller ON sp_listing_issues(seller_id, created_at DESC);

-- ── Module C: Safety Claim (Amazon SAFE-T) ───────────────────
CREATE TABLE IF NOT EXISTS sp_safety_claims (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id      UUID NOT NULL REFERENCES sp_sellers(id) ON DELETE CASCADE,
  marketplace    TEXT NOT NULL DEFAULT 'amazon',
  order_id       TEXT NOT NULL,
  reason         TEXT,
  amount_claimed NUMERIC,
  status         TEXT NOT NULL DEFAULT 'pending',   -- pending|filed|approved|rejected|closed
  image_count    INTEGER NOT NULL DEFAULT 0,
  images_expired BOOLEAN NOT NULL DEFAULT false,
  notes          TEXT,
  filed_at       TIMESTAMPTZ,
  resolution     TEXT,
  created_by      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_sp_claims_seller ON sp_safety_claims(seller_id, status, created_at DESC);

-- Public intake token per seller — backs the customer-facing request form URLs.
ALTER TABLE sp_sellers ADD COLUMN IF NOT EXISTS public_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sp_sellers_token ON sp_sellers(public_token);

-- Installation requests (from the public intake form or entered by staff).
-- lat/lng/geo_source + assignment are used by the service suite (nearest technician).
CREATE TABLE IF NOT EXISTS sp_installations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id      UUID NOT NULL REFERENCES sp_sellers(id) ON DELETE CASCADE,
  customer_name  TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  address        TEXT,
  city           TEXT,
  pincode        TEXT,
  latitude       NUMERIC,
  longitude      NUMERIC,
  geo_source     TEXT,
  product_name   TEXT,
  product_sku    TEXT,
  marketplace    TEXT,
  order_id       TEXT,
  serial_no      TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',   -- pending|scheduled|installed|cancelled
  preferred_date DATE,
  preferred_slot TEXT,
  notes          TEXT,
  source         TEXT DEFAULT 'portal',             -- public|portal
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sp_install_seller ON sp_installations(seller_id, status, created_at DESC);
ALTER TABLE sp_installations ADD COLUMN IF NOT EXISTS maps_link TEXT;
ALTER TABLE sp_installations ADD COLUMN IF NOT EXISTS purchased_from TEXT;
-- Current (latest) technician assignment, denormalized for easy display.
ALTER TABLE sp_installations ADD COLUMN IF NOT EXISTS assigned_tech_name  TEXT;
ALTER TABLE sp_installations ADD COLUMN IF NOT EXISTS assigned_tech_phone TEXT;
ALTER TABLE sp_installations ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE sp_installations ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ;

-- Per-seller custom technician roster (nearest-tech also uses the shared RO directory).
CREATE TABLE IF NOT EXISTS sp_technicians (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id  UUID NOT NULL REFERENCES sp_sellers(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT,
  city       TEXT,
  address    TEXT,
  latitude   NUMERIC,
  longitude  NUMERIC,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_sp_tech_seller ON sp_technicians(seller_id);

-- Technician dispatch history (latest row per installation = current).
CREATE TABLE IF NOT EXISTS sp_installation_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id UUID NOT NULL REFERENCES sp_installations(id) ON DELETE CASCADE,
  seller_id       UUID NOT NULL REFERENCES sp_sellers(id) ON DELETE CASCADE,
  tech_name       TEXT NOT NULL,
  tech_phone      TEXT,
  tech_source     TEXT,              -- directory | custom | manual
  place_id        TEXT,              -- ro_service_leads place_id when from the directory
  distance_km     NUMERIC,
  assigned_by     UUID,
  status          TEXT NOT NULL DEFAULT 'assigned',  -- assigned|confirmed|completed|cancelled
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sp_assign_install ON sp_installation_assignments(installation_id, assigned_at DESC);

-- Ratings & reviews.
CREATE TABLE IF NOT EXISTS sp_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID NOT NULL REFERENCES sp_sellers(id) ON DELETE CASCADE,
  installation_id UUID REFERENCES sp_installations(id) ON DELETE SET NULL,
  product_name    TEXT,
  marketplace     TEXT,
  order_id        TEXT,
  rating          INTEGER,            -- 1..5
  title           TEXT,
  body            TEXT,
  reviewer_name   TEXT,
  reply           TEXT,
  status          TEXT NOT NULL DEFAULT 'published',  -- published|pending|hidden
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sp_reviews_seller ON sp_reviews(seller_id, created_at DESC);

-- Per-seller product catalog (populates the Product/model dropdown on the forms).
CREATE TABLE IF NOT EXISTS sp_products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id  UUID NOT NULL REFERENCES sp_sellers(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sku        TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, name)
);
CREATE INDEX IF NOT EXISTS idx_sp_products_seller ON sp_products(seller_id);
-- Review link (e.g. the product's Amazon/Flipkart review URL) used by the
-- "Send review request" WhatsApp action on installations.
ALTER TABLE sp_products ADD COLUMN IF NOT EXISTS review_link TEXT;

-- Pincode -> lat/lng cache (shared; filled lazily from Google geocoding).
CREATE TABLE IF NOT EXISTS sp_pincode_geo (
  pincode    TEXT PRIMARY KEY,
  lat        NUMERIC NOT NULL,
  lng        NUMERIC NOT NULL,
  source     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function migrate() {
  await db.query(SQL);
  console.log('[MIGRATE] sp_* schema ready');
}

module.exports = { migrate };
