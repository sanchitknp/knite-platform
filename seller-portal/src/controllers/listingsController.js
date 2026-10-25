// Module B — Listing. Manual CRUD now; marketplace API sync is Phase 2.
const db = require('../db');

const clean = (v, n = 300) => (v == null ? null : String(v).trim().slice(0, n) || null);
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const MARKETS = ['amazon', 'flipkart'];
const STATUSES = ['active', 'inactive', 'suppressed', 'draft'];

// GET /api/listings?marketplace=&status=&q=
async function list(req, res) {
  const sid = req.auth.seller_id;
  const params = [sid];
  let where = 'seller_id = $1';
  if (MARKETS.includes(req.query.marketplace)) { params.push(req.query.marketplace); where += ` AND marketplace = $${params.length}`; }
  if (STATUSES.includes(req.query.status)) { params.push(req.query.status); where += ` AND status = $${params.length}`; }
  if (req.query.q) { params.push(`%${String(req.query.q).trim()}%`); where += ` AND (title ILIKE $${params.length} OR sku ILIKE $${params.length} OR marketplace_id ILIKE $${params.length})`; }
  const r = await db.query(
    `SELECT id, marketplace, sku, marketplace_id, title, brand, category, mrp, selling_price,
            stock, status, buybox_status, last_synced_at, updated_at
       FROM sp_listings WHERE ${where} ORDER BY updated_at DESC LIMIT 1000`,
    params
  );
  res.json(r.rows);
}

// POST /api/listings
async function create(req, res) {
  const sid = req.auth.seller_id;
  const b = req.body || {};
  const marketplace = MARKETS.includes(b.marketplace) ? b.marketplace : null;
  if (!marketplace) return res.status(400).json({ error: 'marketplace must be amazon or flipkart' });
  const title = clean(b.title, 500);
  if (!title && !b.marketplace_id) return res.status(400).json({ error: 'title or marketplace_id required' });
  const status = STATUSES.includes(b.status) ? b.status : 'active';
  try {
    const r = await db.query(
      `INSERT INTO sp_listings
         (seller_id, marketplace, sku, marketplace_id, title, brand, category, mrp, selling_price, stock, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [sid, marketplace, clean(b.sku, 80), clean(b.marketplace_id, 40), title, clean(b.brand, 120),
       clean(b.category, 120), num(b.mrp), num(b.selling_price), num(b.stock), status]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A listing with this marketplace ID already exists' });
    throw e;
  }
}

// PATCH /api/listings/:id
async function update(req, res) {
  const sid = req.auth.seller_id;
  const b = req.body || {};
  const sets = [];
  const params = [req.params.id, sid];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (b.title !== undefined) add('title', clean(b.title, 500));
  if (b.sku !== undefined) add('sku', clean(b.sku, 80));
  if (b.brand !== undefined) add('brand', clean(b.brand, 120));
  if (b.category !== undefined) add('category', clean(b.category, 120));
  if (b.mrp !== undefined) add('mrp', num(b.mrp));
  if (b.selling_price !== undefined) add('selling_price', num(b.selling_price));
  if (b.stock !== undefined) add('stock', num(b.stock));
  if (b.status && STATUSES.includes(b.status)) add('status', b.status);
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  sets.push('updated_at = now()');
  const r = await db.query(
    `UPDATE sp_listings SET ${sets.join(', ')} WHERE id = $1 AND seller_id = $2 RETURNING *`,
    params
  );
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  res.json(r.rows[0]);
}

// DELETE /api/listings/:id
async function remove(req, res) {
  const r = await db.query('DELETE FROM sp_listings WHERE id = $1 AND seller_id = $2', [req.params.id, req.auth.seller_id]);
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}

module.exports = { list, create, update, remove };
