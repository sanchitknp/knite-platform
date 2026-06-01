-- ── Reviews & Ratings ──
CREATE TABLE IF NOT EXISTS shop_reviews (
  id              BIGSERIAL PRIMARY KEY,
  product_id      BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id     BIGINT REFERENCES shop_customers(id) ON DELETE SET NULL,
  order_id        BIGINT REFERENCES shop_orders(id) ON DELETE SET NULL,
  reviewer_name   TEXT NOT NULL,
  reviewer_city   TEXT,
  rating          INT  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title           TEXT,
  body            TEXT,
  is_verified     BOOLEAN DEFAULT TRUE,
  status          TEXT    DEFAULT 'published',
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_reviews_product  ON shop_reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_shop_reviews_customer ON shop_reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_shop_reviews_status   ON shop_reviews(status);

-- One review per customer per product (enforced when customer_id present)
CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_reviews_customer_product
  ON shop_reviews(customer_id, product_id) WHERE customer_id IS NOT NULL;
