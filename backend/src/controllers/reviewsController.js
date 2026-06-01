// ─────────────────────────────────────────────
// Reviews — public list + eligibility + create
// ─────────────────────────────────────────────
const { pool } = require('../db');

async function productIdFromSlug(slug) {
  const r = await pool.query('SELECT id FROM products WHERE slug = $1 AND is_active = TRUE LIMIT 1', [slug]);
  return r.rows[0] && r.rows[0].id;
}

// GET /api/shop/products/:slug/reviews
async function listReviews(req, res) {
  try {
    const pid = await productIdFromSlug(req.params.slug);
    if (!pid) return res.status(404).json({ error: 'Product not found' });

    const [reviewsR, aggR] = await Promise.all([
      pool.query(
        `SELECT id, reviewer_name, reviewer_city, rating, title, body, is_verified, created_at
         FROM shop_reviews
         WHERE product_id = $1 AND status = 'published'
         ORDER BY created_at DESC
         LIMIT 50`,
        [pid]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count,
                COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS avg,
                COUNT(*) FILTER (WHERE rating = 5)::int AS r5,
                COUNT(*) FILTER (WHERE rating = 4)::int AS r4,
                COUNT(*) FILTER (WHERE rating = 3)::int AS r3,
                COUNT(*) FILTER (WHERE rating = 2)::int AS r2,
                COUNT(*) FILTER (WHERE rating = 1)::int AS r1
         FROM shop_reviews
         WHERE product_id = $1 AND status = 'published'`,
        [pid]
      ),
    ]);

    res.json({
      reviews: reviewsR.rows,
      aggregate: aggR.rows[0] || { count: 0, avg: 0, r5: 0, r4: 0, r3: 0, r2: 0, r1: 0 },
    });
  } catch (e) {
    console.error('[REVIEWS] list:', e);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
}

// GET /api/shop/products/:slug/review-eligibility — requires login
async function getEligibility(req, res) {
  try {
    if (!req.shopCustomer) {
      return res.json({ canReview: false, reason: 'not-logged-in', message: 'Please log in to write a review.' });
    }
    const pid = await productIdFromSlug(req.params.slug);
    if (!pid) return res.status(404).json({ error: 'Product not found' });

    // Already reviewed?
    const existing = await pool.query(
      `SELECT id FROM shop_reviews WHERE product_id = $1 AND customer_id = $2 LIMIT 1`,
      [pid, req.shopCustomer.id]
    );
    if (existing.rows.length) {
      return res.json({ canReview: false, reason: 'already-reviewed', message: 'You have already reviewed this product.' });
    }

    // Has this customer received a delivered order containing this product?
    const orderR = await pool.query(
      `SELECT o.id, o.status
       FROM shop_orders o
       JOIN shop_order_items i ON i.order_id = o.id
       WHERE o.customer_id = $1
         AND i.product_id = $2
         AND o.status = 'delivered'
       ORDER BY o.created_at DESC LIMIT 1`,
      [req.shopCustomer.id, pid]
    );
    if (!orderR.rows.length) {
      return res.json({
        canReview: false,
        reason: 'no-purchase',
        message: 'Only customers who have purchased and received this product can write a review.',
      });
    }
    return res.json({ canReview: true, orderId: orderR.rows[0].id });
  } catch (e) {
    console.error('[REVIEWS] eligibility:', e);
    res.status(500).json({ error: 'Failed to check eligibility' });
  }
}

// POST /api/shop/products/:slug/reviews — requires login + delivered purchase
async function createReview(req, res) {
  try {
    if (!req.shopCustomer) return res.status(401).json({ error: 'Login required' });

    const slug = req.params.slug;
    const pid = await productIdFromSlug(slug);
    if (!pid) return res.status(404).json({ error: 'Product not found' });

    let { rating, title, body } = req.body || {};
    rating = Number(rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be 1–5' });
    }
    title = (title || '').toString().trim().slice(0, 120);
    body  = (body  || '').toString().trim().slice(0, 2000);
    if (body.length < 10) return res.status(400).json({ error: 'Review must be at least 10 characters' });

    // Verify a delivered order exists for this customer + product
    const orderR = await pool.query(
      `SELECT o.id, COALESCE(o.shipping_address->>'city','') AS city
       FROM shop_orders o
       JOIN shop_order_items i ON i.order_id = o.id
       WHERE o.customer_id = $1
         AND i.product_id = $2
         AND o.status = 'delivered'
       ORDER BY o.created_at DESC LIMIT 1`,
      [req.shopCustomer.id, pid]
    );
    if (!orderR.rows.length) {
      return res.status(403).json({ error: 'Only verified buyers (delivered order) can review this product' });
    }

    // Insert (unique index will reject duplicates)
    const ins = await pool.query(
      `INSERT INTO shop_reviews (product_id, customer_id, order_id, reviewer_name, reviewer_city, rating, title, body, is_verified, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,'published')
       RETURNING id, reviewer_name, reviewer_city, rating, title, body, is_verified, created_at`,
      [
        pid,
        req.shopCustomer.id,
        orderR.rows[0].id,
        req.shopCustomer.name || 'Verified Buyer',
        orderR.rows[0].city || null,
        rating,
        title,
        body,
      ]
    );
    res.status(201).json({ review: ins.rows[0] });
  } catch (e) {
    if (String(e.message || '').includes('uq_shop_reviews_customer_product')) {
      return res.status(409).json({ error: 'You have already reviewed this product' });
    }
    console.error('[REVIEWS] create:', e);
    res.status(500).json({ error: 'Failed to create review' });
  }
}

module.exports = { listReviews, getEligibility, createReview };
