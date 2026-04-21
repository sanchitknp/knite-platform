-- Knite Platform Database Schema
-- Version 1.0

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- 1. CUSTOMERS
-- ─────────────────────────────────────────────
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 2. ZONES
-- ─────────────────────────────────────────────
CREATE TABLE zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Delhi NCR',
  pincodes TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 3. TECHNICIANS
-- ─────────────────────────────────────────────
CREATE TABLE technicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  home_zone_id UUID REFERENCES zones(id),
  is_verified BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT false,
  kyc_doc_url TEXT,
  aadhaar_hash TEXT,
  rating NUMERIC(3,2) DEFAULT 5.0,
  jobs_completed INT DEFAULT 0,
  dispute_count INT DEFAULT 0,
  bank_upi TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 4. TECHNICIAN ZONES (multi-zone opt-in)
-- ─────────────────────────────────────────────
CREATE TABLE technician_zones (
  technician_id UUID REFERENCES technicians(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES zones(id) ON DELETE CASCADE,
  is_home BOOLEAN DEFAULT false,
  PRIMARY KEY (technician_id, zone_id)
);

-- ─────────────────────────────────────────────
-- 5. UNITS (Central Entity)
-- ─────────────────────────────────────────────
CREATE TABLE units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id TEXT UNIQUE NOT NULL,
  customer_id UUID REFERENCES customers(id),
  zone_id UUID REFERENCES zones(id),
  status TEXT NOT NULL DEFAULT 'manufactured',
  -- manufactured, shipped, registered, install_pending,
  -- install_dispatched, active, support_open, maintenance_due,
  -- maintenance_dispatched, deactivated, returned,
  -- pending_manual_action (unserviced pincode, awaiting team follow-up)
  install_address JSONB,
  install_date TIMESTAMPTZ,
  warranty_expires_at TIMESTAMPTZ,
  next_maintenance_at TIMESTAMPTZ,
  maintenance_cycle INT DEFAULT 0,
  model TEXT DEFAULT 'Knite RO Standard',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 6. JOBS
-- ─────────────────────────────────────────────
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  technician_id UUID REFERENCES technicians(id),
  zone_id UUID REFERENCES zones(id),
  type TEXT NOT NULL,
  -- install, repair, maintenance
  status TEXT NOT NULL DEFAULT 'created',
  -- created, scheduled, broadcasting, assigned, en_route,
  -- in_progress, pending_verification, completed, cancelled, failed, disputed
  issue_type TEXT,
  issue_notes TEXT,
  issue_media_url TEXT,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  otp TEXT,
  otp_hash TEXT,
  otp_verified BOOLEAN DEFAULT false,
  payout_paise BIGINT NOT NULL DEFAULT 0,
  customer_charge_paise BIGINT DEFAULT 0,
  is_warranty BOOLEAN DEFAULT true,
  proof_photos JSONB DEFAULT '[]',
  customer_rating INT,
  broadcast_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 7. JOB BROADCASTS
-- ─────────────────────────────────────────────
CREATE TABLE job_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  technician_id UUID NOT NULL REFERENCES technicians(id),
  status TEXT NOT NULL DEFAULT 'sent',
  -- sent, accepted, declined, expired
  sent_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ,
  UNIQUE(job_id, technician_id)
);

-- ─────────────────────────────────────────────
-- 8. UNIT EVENTS (Immutable audit log)
-- ─────────────────────────────────────────────
CREATE TABLE unit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id),
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_type TEXT,
  -- customer, technician, system, admin
  actor_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 9. JOB EVENTS (Immutable audit log)
-- ─────────────────────────────────────────────
CREATE TABLE job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_type TEXT,
  actor_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 10. WHATSAPP SESSIONS
-- ─────────────────────────────────────────────
CREATE TABLE whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  actor_type TEXT DEFAULT 'customer',
  -- customer, technician
  flow TEXT,
  -- installation, support, maintenance, tech_onboarding, ownership_transfer
  step TEXT,
  context_data JSONB DEFAULT '{}',
  last_message_at TIMESTAMPTZ DEFAULT now(),
  session_expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '24 hours',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 11. MAINTENANCE SCHEDULES
-- ─────────────────────────────────────────────
CREATE TABLE maintenance_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  cycle_number INT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending, reminded, snoozed, skipped, completed
  reminder_count INT DEFAULT 0,
  last_reminded_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 12. PAYMENTS
-- ─────────────────────────────────────────────
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id),
  customer_id UUID REFERENCES customers(id),
  amount_paise BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending, completed, failed, refunded
  method TEXT DEFAULT 'upi',
  reference TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ─────────────────────────────────────────────
-- 13. LEDGER ENTRIES
-- ─────────────────────────────────────────────
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id),
  technician_id UUID REFERENCES technicians(id),
  type TEXT NOT NULL,
  -- tech_payout, customer_charge, platform_fee, parts_cost
  amount_paise BIGINT NOT NULL,
  settled BOOLEAN DEFAULT false,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 14. WA MESSAGE DEDUP
-- ─────────────────────────────────────────────
CREATE TABLE wa_message_dedup (
  message_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 15. OUTBOUND MESSAGES (Simulator queue)
-- ─────────────────────────────────────────────
CREATE TABLE outbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_phone TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  -- text, buttons, list
  body TEXT NOT NULL,
  buttons JSONB,
  -- [{id, title}]
  delivered BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX idx_units_unit_id ON units(unit_id);
CREATE INDEX idx_units_customer_id ON units(customer_id);
CREATE INDEX idx_units_status ON units(status);
CREATE INDEX idx_jobs_unit_id ON jobs(unit_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_technician_id ON jobs(technician_id);
CREATE INDEX idx_job_broadcasts_job_id ON job_broadcasts(job_id);
CREATE INDEX idx_job_broadcasts_technician_id ON job_broadcasts(technician_id);
CREATE INDEX idx_whatsapp_sessions_phone ON whatsapp_sessions(phone);
CREATE INDEX idx_maintenance_due ON maintenance_schedules(due_at, status);
CREATE INDEX idx_outbound_phone ON outbound_messages(to_phone, delivered);

-- ─────────────────────────────────────────────
-- ATOMIC JOB ACCEPTANCE FUNCTION
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accept_job_broadcast(
  p_job_id UUID,
  p_technician_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_current_status TEXT;
  v_job RECORD;
BEGIN
  -- Lock job row exclusively
  SELECT status INTO v_current_status
  FROM jobs
  WHERE id = p_job_id
  FOR UPDATE;

  -- Only accept if still broadcasting
  IF v_current_status != 'broadcasting' THEN
    RETURN FALSE;
  END IF;

  -- Update job to assigned
  UPDATE jobs SET
    status = 'assigned',
    technician_id = p_technician_id,
    updated_at = now()
  WHERE id = p_job_id;

  -- Mark this broadcast as accepted
  UPDATE job_broadcasts SET
    status = 'accepted',
    responded_at = now()
  WHERE job_id = p_job_id AND technician_id = p_technician_id;

  -- Expire all other broadcasts
  UPDATE job_broadcasts SET
    status = 'expired',
    responded_at = now()
  WHERE job_id = p_job_id
    AND technician_id != p_technician_id
    AND status = 'sent';

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- HELPER: Log unit event
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_unit_event(
  p_unit_id UUID,
  p_type TEXT,
  p_from_status TEXT,
  p_to_status TEXT,
  p_actor_type TEXT DEFAULT 'system',
  p_actor_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
) RETURNS VOID AS $$
BEGIN
  INSERT INTO unit_events (unit_id, type, from_status, to_status, actor_type, actor_id, metadata)
  VALUES (p_unit_id, p_type, p_from_status, p_to_status, p_actor_type, p_actor_id, p_metadata);
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- HELPER: Log job event
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_job_event(
  p_job_id UUID,
  p_type TEXT,
  p_from_status TEXT,
  p_to_status TEXT,
  p_actor_type TEXT DEFAULT 'system',
  p_actor_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
) RETURNS VOID AS $$
BEGIN
  INSERT INTO job_events (job_id, type, from_status, to_status, actor_type, actor_id, metadata)
  VALUES (p_job_id, p_type, p_from_status, p_to_status, p_actor_type, p_actor_id, p_metadata);
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- INDIA POST PINCODE DIRECTORY
-- Loaded from a public CSV (India Post). Referenced by techFlow
-- (state/area list during onboarding) and installationFlow (pincode lookup).
-- The CSV load happens in infra/deploy.sh on first bootstrap.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS india_pincodes (
  id            SERIAL PRIMARY KEY,
  circle_name   TEXT,
  region_name   TEXT,
  division_name TEXT,
  area_name     TEXT,   -- officename
  pincode       TEXT,
  office_type   TEXT,
  delivery      TEXT,
  district      TEXT,
  state         TEXT,   -- stored in Title Case (normalised from ALL CAPS)
  latitude      TEXT,
  longitude     TEXT
);
CREATE INDEX IF NOT EXISTS idx_india_pincodes_state   ON india_pincodes(state);
CREATE INDEX IF NOT EXISTS idx_india_pincodes_pincode ON india_pincodes(pincode);
