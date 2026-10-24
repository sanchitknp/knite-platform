-- Additive migration for public technician applications. Existing technicians
-- retain their zone-based coverage when coverage_pincodes is empty.
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS google_maps_link TEXT;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS coverage_pincodes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS registration_source TEXT;
CREATE INDEX IF NOT EXISTS idx_technician_coverage ON technicians USING GIN (coverage_pincodes);
