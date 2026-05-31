-- ─────────────────────────────────────────────────────────────────────────
-- KNITE E-COMMERCE SCHEMA — Products, Orders, Order Items
-- Apply on top of existing schema. Idempotent (CREATE IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────

-- ── PRODUCTS ──
CREATE TABLE IF NOT EXISTS products (
  id              SERIAL PRIMARY KEY,
  slug            VARCHAR(120) UNIQUE NOT NULL,
  sku             VARCHAR(60)  UNIQUE NOT NULL,
  name            VARCHAR(255) NOT NULL,
  short_desc      TEXT,
  long_desc       TEXT,
  brand           VARCHAR(100) DEFAULT 'Knite',
  category        VARCHAR(100) DEFAULT 'Water Purifier',
  hsn_code        VARCHAR(20)  DEFAULT '84212100',
  mrp             NUMERIC(10,2) NOT NULL,
  selling_price   NUMERIC(10,2) NOT NULL,
  gst_rate        NUMERIC(5,2)  DEFAULT 18,
  weight_kg       NUMERIC(6,3),
  warranty_months INT DEFAULT 12,
  capacity_litres NUMERIC(6,2),
  features        JSONB DEFAULT '[]'::jsonb,
  specs           JSONB DEFAULT '{}'::jsonb,
  images          JSONB DEFAULT '[]'::jsonb,
  stock           INT  DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  is_featured     BOOLEAN DEFAULT FALSE,
  sort_order      INT  DEFAULT 100,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(is_featured) WHERE is_featured = TRUE;

-- ── SHOP ORDERS ──
CREATE TABLE IF NOT EXISTS shop_orders (
  id                  SERIAL PRIMARY KEY,
  order_number        VARCHAR(30) UNIQUE NOT NULL,

  -- Customer (guest checkout — no FK to a customer table)
  customer_name       VARCHAR(255) NOT NULL,
  customer_email      VARCHAR(255) NOT NULL,
  customer_phone      VARCHAR(20)  NOT NULL,

  -- Pricing breakdown (all stored to lock historical values)
  subtotal            NUMERIC(10,2) NOT NULL,
  tax_amount          NUMERIC(10,2) NOT NULL,
  shipping_amount     NUMERIC(10,2) DEFAULT 0,
  discount_amount     NUMERIC(10,2) DEFAULT 0,
  total_amount        NUMERIC(10,2) NOT NULL,

  -- Shipping address (JSON snapshot to preserve at order time)
  shipping_address    JSONB NOT NULL,
  billing_address     JSONB,

  -- Order lifecycle
  status              VARCHAR(30) DEFAULT 'pending',
    -- pending → confirmed → processing → shipped → delivered → cancelled / refunded
  payment_status      VARCHAR(30) DEFAULT 'pending',
    -- pending → paid → failed → refunded
  payment_method      VARCHAR(30) DEFAULT 'cod',
    -- cod, razorpay, bank_transfer

  -- Payment gateway (Razorpay) refs — populated when used
  razorpay_order_id   VARCHAR(100),
  razorpay_payment_id VARCHAR(100),
  razorpay_signature  VARCHAR(255),

  -- Shipping tracking
  tracking_number     VARCHAR(120),
  shipping_carrier    VARCHAR(100),

  -- Internal
  notes               TEXT,
  admin_notes         TEXT,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  paid_at             TIMESTAMP WITH TIME ZONE,
  shipped_at          TIMESTAMP WITH TIME ZONE,
  delivered_at        TIMESTAMP WITH TIME ZONE,
  cancelled_at        TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_shop_orders_phone  ON shop_orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_shop_orders_status ON shop_orders(status);
CREATE INDEX IF NOT EXISTS idx_shop_orders_created_at ON shop_orders(created_at DESC);

-- ── SHOP ORDER ITEMS ──
CREATE TABLE IF NOT EXISTS shop_order_items (
  id              SERIAL PRIMARY KEY,
  order_id        INT REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id      INT REFERENCES products(id) ON DELETE SET NULL,
  product_name    VARCHAR(255) NOT NULL,
  product_sku     VARCHAR(60),
  unit_price      NUMERIC(10,2) NOT NULL,
  quantity        INT NOT NULL,
  line_subtotal   NUMERIC(10,2) NOT NULL,
  line_tax        NUMERIC(10,2) NOT NULL,
  line_total      NUMERIC(10,2) NOT NULL,
  hsn_code        VARCHAR(20),
  gst_rate        NUMERIC(5,2),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_order_items_order ON shop_order_items(order_id);

-- ── ORDER NUMBER SEQUENCE GENERATOR ──
-- Produces order numbers like KN-26-00001, KN-26-00002 (year-prefixed)
CREATE SEQUENCE IF NOT EXISTS shop_order_seq START 1;
