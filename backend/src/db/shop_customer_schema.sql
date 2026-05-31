-- ─────────────────────────────────────────────────────────────────────────
-- KNITE SHOP CUSTOMERS — OTP-based phone auth (no passwords).
-- Sessions stored in shop_sessions, secured by HTTP-only cookie.
-- ─────────────────────────────────────────────────────────────────────────

-- Customer profiles
CREATE TABLE IF NOT EXISTS shop_customers (
  id              SERIAL PRIMARY KEY,
  phone           VARCHAR(15) UNIQUE NOT NULL,   -- 10-digit Indian mobile
  email           VARCHAR(255),
  name            VARCHAR(255),
  phone_verified  BOOLEAN DEFAULT FALSE,
  email_verified  BOOLEAN DEFAULT FALSE,
  marketing_optin BOOLEAN DEFAULT TRUE,
  total_orders    INT DEFAULT 0,
  total_spent     NUMERIC(12,2) DEFAULT 0,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at   TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_shop_customers_phone ON shop_customers(phone);

-- Saved shipping addresses (1 customer → many addresses)
CREATE TABLE IF NOT EXISTS shop_customer_addresses (
  id              SERIAL PRIMARY KEY,
  customer_id     INT NOT NULL REFERENCES shop_customers(id) ON DELETE CASCADE,
  label           VARCHAR(50) DEFAULT 'Home',
  full_name       VARCHAR(255) NOT NULL,
  phone           VARCHAR(15) NOT NULL,
  line1           VARCHAR(255) NOT NULL,
  line2           VARCHAR(255),
  city            VARCHAR(100) NOT NULL,
  state           VARCHAR(100) NOT NULL,
  pincode         VARCHAR(10)  NOT NULL,
  country         VARCHAR(2)   DEFAULT 'IN',
  is_default      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_addr_customer ON shop_customer_addresses(customer_id);

-- OTP store (short-lived, 10 minute expiry)
CREATE TABLE IF NOT EXISTS shop_otps (
  id              SERIAL PRIMARY KEY,
  phone           VARCHAR(15) NOT NULL,
  otp_code        VARCHAR(10) NOT NULL,
  attempts        INT DEFAULT 0,
  used            BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at      TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_otps_phone ON shop_otps(phone, used, expires_at DESC);

-- Session tokens (cookie-based auth)
CREATE TABLE IF NOT EXISTS shop_sessions (
  token           VARCHAR(64) PRIMARY KEY,
  customer_id     INT NOT NULL REFERENCES shop_customers(id) ON DELETE CASCADE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at      TIMESTAMP WITH TIME ZONE NOT NULL,
  user_agent      TEXT,
  ip_address      VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_shop_sessions_expires ON shop_sessions(expires_at);

-- Link existing shop_orders to a customer (nullable for backward compat)
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES shop_customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_shop_orders_customer ON shop_orders(customer_id);
