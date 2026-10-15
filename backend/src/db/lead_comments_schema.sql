-- Admin comments on RO service leads (technicians), keyed by Google place_id.
CREATE TABLE IF NOT EXISTS ro_service_lead_comments (
  id         SERIAL PRIMARY KEY,
  place_id   TEXT NOT NULL,
  comment    TEXT NOT NULL,
  author     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rsl_comments_place ON ro_service_lead_comments(place_id);
