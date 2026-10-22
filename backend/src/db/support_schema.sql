-- ============================================================
-- Knite — Support & Installation request tables
-- Backs the public /support page (two flows) + admin tabs.
-- Idempotent: safe to run repeatedly against an existing RDS.
-- ============================================================

-- Human-friendly, sequential reference numbers (KN-INST-1001, KN-TKT-1001, …)
CREATE SEQUENCE IF NOT EXISTS installation_ref_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS ticket_ref_seq       START 1001;

-- ── Installation requests ───────────────────────────────────
CREATE TABLE IF NOT EXISTS installation_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref            TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL,
  email          TEXT,
  product_slug   TEXT,
  product_name   TEXT,
  serial_no      TEXT,             -- unique device ID printed on the RO side panel
  purchased_from TEXT,             -- website / amazon / flipkart / offline / other
  order_ref      TEXT,
  address        TEXT,
  city           TEXT,
  pincode        TEXT,
  zone_id        UUID REFERENCES zones(id),
  serviceable    BOOLEAN,
  preferred_date DATE,
  preferred_slot TEXT,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'new',   -- new, contacted, scheduled, installed, cancelled
  admin_notes    TEXT,
  source         TEXT DEFAULT 'website',
  shop_customer_id UUID,           -- soft link if the customer was logged in
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Additive migration for already-created tables (idempotent):
ALTER TABLE installation_requests ADD COLUMN IF NOT EXISTS serial_no TEXT;
ALTER TABLE installation_requests ADD COLUMN IF NOT EXISTS latitude  NUMERIC;
ALTER TABLE installation_requests ADD COLUMN IF NOT EXISTS longitude NUMERIC;
ALTER TABLE installation_requests ADD COLUMN IF NOT EXISTS maps_link TEXT;
ALTER TABLE installation_requests ADD COLUMN IF NOT EXISTS installation_charge NUMERIC;
ALTER TABLE installation_requests ADD COLUMN IF NOT EXISTS geo_source TEXT;   -- pin | geocoded | pincode
-- WhatsApp communication state tracking:
ALTER TABLE installation_requests ADD COLUMN IF NOT EXISTS notified_at     TIMESTAMPTZ;
ALTER TABLE installation_requests ADD COLUMN IF NOT EXISTS status_asked_at TIMESTAMPTZ;
ALTER TABLE installation_requests ADD COLUMN IF NOT EXISTS review_sent_at  TIMESTAMPTZ;
ALTER TABLE installation_requests ADD COLUMN IF NOT EXISTS tech_lang TEXT;   -- saved WhatsApp language (technician)
ALTER TABLE installation_requests ADD COLUMN IF NOT EXISTS cust_lang TEXT;   -- saved WhatsApp language (customer)

CREATE INDEX IF NOT EXISTS idx_install_status  ON installation_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_install_pincode ON installation_requests(pincode);
CREATE INDEX IF NOT EXISTS idx_install_serial  ON installation_requests(serial_no);

-- ── Support tickets ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref            TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL,
  email          TEXT,
  category       TEXT NOT NULL,    -- not_working, leakage, filter_amc, warranty, order, billing, other …
  serial_no      TEXT,             -- unique device ID printed on the RO side wall
  product_slug   TEXT,
  product_name   TEXT,
  order_ref      TEXT,
  subject        TEXT NOT NULL,
  description    TEXT NOT NULL,
  city           TEXT,
  pincode        TEXT,
  priority       TEXT DEFAULT 'normal',          -- low, normal, high, urgent
  status         TEXT NOT NULL DEFAULT 'open',    -- open, in_progress, waiting, resolved, closed
  admin_notes    TEXT,
  source         TEXT DEFAULT 'website',
  shop_customer_id UUID,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Additive migration for already-created tables (idempotent):
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS serial_no TEXT;

CREATE INDEX IF NOT EXISTS idx_ticket_status   ON support_tickets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_category ON support_tickets(category);
CREATE INDEX IF NOT EXISTS idx_ticket_serial   ON support_tickets(serial_no);

-- ─────────────────────────────────────────────
-- INSTALLATION ↔ TECHNICIAN ASSIGNMENTS
-- Records which technician (registered tech or RO service lead) was dispatched
-- for each installation request, with who assigned it and when. Keeps the full
-- history (one row per assignment); the latest row is the current assignment.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS installation_assignments (
  id               SERIAL PRIMARY KEY,
  installation_id  UUID NOT NULL REFERENCES installation_requests(id) ON DELETE CASCADE,
  installation_ref TEXT,
  place_id         TEXT,            -- ro_service_leads place_id when the tech is a Google lead
  tech_name        TEXT NOT NULL,
  tech_phone       TEXT,
  tech_address     TEXT,
  tech_city        TEXT,
  source           TEXT,            -- 'nearest' | 'find-techs' | 'registered' | 'lead'
  assigned_by      TEXT,            -- admin username
  status           TEXT NOT NULL DEFAULT 'assigned',  -- assigned, confirmed, completed, cancelled
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_install_assign_install ON installation_assignments(installation_id);

-- ─────────────────────────────────────────────
-- CUSTOM TECHNICIANS ROSTER
-- A deduplicated list of technicians entered manually (by name + mobile) via the
-- admin "➕ Custom Tech" flow — kept so they can be reused/looked up later. One row
-- per unique phone; times_assigned/last_assigned_at track reuse. Per-installation
-- dispatch history still lives in installation_assignments (source = 'custom').
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_technicians (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT,
  phone            TEXT UNIQUE NOT NULL,   -- canonical digits, 91-prefixed
  raw_phone        TEXT,                   -- exactly as the admin typed it
  city             TEXT,
  address          TEXT,
  added_by         TEXT,                   -- admin username
  times_assigned   INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_custom_tech_phone ON custom_technicians(phone);

-- ─────────────────────────────────────────────
-- PINCODE → CENTROID CACHE
-- Self-populated by the geocoder service: the first time a 6-digit pincode is seen
-- it is geocoded once via Google and cached here, so repeat pincodes resolve
-- offline/free afterwards. Used as the fallback when a full-address geocode fails.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pincode_geo (
  pincode    TEXT PRIMARY KEY,
  lat        NUMERIC NOT NULL,
  lng        NUMERIC NOT NULL,
  source     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
