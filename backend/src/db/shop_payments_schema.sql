-- ─────────────────────────────────────────────────────────────
-- Cashfree payment columns on shop_orders + payment events log
-- Idempotent (safe to run multiple times)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS payment_status      TEXT DEFAULT 'pending';
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS cashfree_order_id   TEXT;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS cashfree_payment_id TEXT;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS payment_method      TEXT;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS paid_at              TIMESTAMPTZ;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS refund_amount       NUMERIC(10,2) DEFAULT 0;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS refunded_at          TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_shop_orders_cf_order ON shop_orders(cashfree_order_id);
CREATE INDEX IF NOT EXISTS idx_shop_orders_paystat  ON shop_orders(payment_status);

-- Audit log of all webhook + verify events (for debugging / reconciliation)
CREATE TABLE IF NOT EXISTS payment_events (
  id              BIGSERIAL PRIMARY KEY,
  order_id        BIGINT REFERENCES shop_orders(id) ON DELETE SET NULL,
  cashfree_order_id   TEXT,
  cashfree_payment_id TEXT,
  event_type      TEXT NOT NULL,         -- e.g. PAYMENT_SUCCESS_WEBHOOK
  source          TEXT NOT NULL,         -- 'webhook' | 'verify' | 'create'
  raw_payload     JSONB,
  signature_ok    BOOLEAN,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_events_order ON payment_events(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_cf    ON payment_events(cashfree_order_id);
