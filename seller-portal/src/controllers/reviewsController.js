// Ratings & reviews — scoped by seller_id. Manual entry now; marketplace sync later.
const db = require('../db');

const clean = (v, n = 2000) => (v == null ? null : String(v).trim().slice(0, n) || null);
const STATUSES = ['published', 'pending', 'hidden'];
const rating = (v) => { const n = parseInt(v, 10); return (n >= 1 && n <= 5) ? n : null; };

// GET /api/reviews?status=&q=
async function list(req, res) {
  const sid = req.auth.seller_id;
  const params = [sid];
  let where = 'seller_id = $1';
  if (STATUSES.includes(req.query.status)) { params.push(req.query.status); where += ` AND status = $${params.length}`; }
  if (req.query.q) { params.push(`%${String(req.query.q).trim()}%`); where += ` AND (product_name ILIKE $${params.length} OR title ILIKE $${params.length} OR body ILIKE $${params.length} OR reviewer_name ILIKE $${params.length})`; }
  const r = await db.query(
    `SELECT id, product_name, marketplace, order_id, rating, title, body, reviewer_name, reply, status, created_at
       FROM sp_reviews WHERE ${where} ORDER BY created_at DESC LIMIT 500`,
    params
  );
  const agg = await db.query(
    `SELECT COUNT(*)::int AS count, COALESCE(ROUND(AVG(rating)::numeric,2),0) AS avg_rating
       FROM sp_reviews WHERE seller_id = $1 AND rating IS NOT NULL`, [sid]
  );
  res.json({ reviews: r.rows, summary: agg.rows[0] });
}

// POST /api/reviews
async function create(req, res) {
  const sid = req.auth.seller_id;
  const b = req.body || {};
  const rt = rating(b.rating);
  if (!rt) return res.status(400).json({ error: 'rating (1-5) is required' });
  const r = await db.query(
    `INSERT INTO sp_reviews (seller_id, product_name, marketplace, order_id, rating, title, body, reviewer_name, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [sid, clean(b.product_name, 200), clean(b.marketplace, 20), clean(b.order_id, 80), rt,
     clean(b.title, 200), clean(b.body, 4000), clean(b.reviewer_name, 120),
     STATUSES.includes(b.status) ? b.status : 'published']
  );
  res.json(r.rows[0]);
}

// PATCH /api/reviews/:id  { reply?, status?, ... }
async function update(req, res) {
  const sid = req.auth.seller_id;
  const b = req.body || {};
  const sets = []; const params = [req.params.id, sid];
  const add = (c, v) => { params.push(v); sets.push(`${c} = $${params.length}`); };
  if (b.reply !== undefined) add('reply', clean(b.reply, 4000));
  if (b.status && STATUSES.includes(b.status)) add('status', b.status);
  if (b.title !== undefined) add('title', clean(b.title, 200));
  if (b.body !== undefined) add('body', clean(b.body, 4000));
  if (b.rating !== undefined) { const rt = rating(b.rating); if (rt) add('rating', rt); }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  sets.push('updated_at = now()');
  const r = await db.query(
    `UPDATE sp_reviews SET ${sets.join(', ')} WHERE id = $1 AND seller_id = $2 RETURNING *`,
    params
  );
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  res.json(r.rows[0]);
}

// DELETE /api/reviews/:id
async function remove(req, res) {
  const r = await db.query('DELETE FROM sp_reviews WHERE id = $1 AND seller_id = $2', [req.params.id, req.auth.seller_id]);
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}

module.exports = { list, create, update, remove };
