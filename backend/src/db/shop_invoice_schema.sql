-- Invoice fields for orders (idempotent)
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(40);
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS invoice_url    TEXT;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS invoice_generated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_shop_orders_invoice_num ON shop_orders(invoice_number) WHERE invoice_number IS NOT NULL;

-- Sequence for invoice numbering (KN/INV/26-27/00001 style)
CREATE SEQUENCE IF NOT EXISTS shop_invoice_seq START 1;
