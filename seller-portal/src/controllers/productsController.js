// Per-seller product catalog. Read is open to any logged-in user (staff need it
// to pick a product); create/update/delete are gated by settings.manage in server.js.
const db = require('../db');

const clean = (v, n = 200) => (v == null ? null : String(v).trim().slice(0, n) || null);

// GET /api/products
async function list(req, res) {
  const r = await db.query(
    'SELECT id, name, sku, review_link, active, created_at FROM sp_products WHERE seller_id = $1 ORDER BY active DESC, name',
    [req.auth.seller_id]
  );
  res.json(r.rows);
}

// POST /api/products
async function create(req, res) {
  const name = clean(req.body?.name, 200);
  if (!name) return res.status(400).json({ error: 'product name required' });
  try {
    const r = await db.query(
      'INSERT INTO sp_products (seller_id, name, sku, review_link) VALUES ($1,$2,$3,$4) RETURNING id, name, sku, review_link, active, created_at',
      [req.auth.seller_id, name, clean(req.body?.sku, 80), clean(req.body?.review_link, 500)]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A product with this name already exists' });
    throw e;
  }
}

// PATCH /api/products/:id  { name?, sku?, active? }
async function update(req, res) {
  const b = req.body || {};
  const sets = []; const params = [req.params.id, req.auth.seller_id];
  const add = (c, v) => { params.push(v); sets.push(`${c} = $${params.length}`); };
  if (b.name !== undefined) { const n = clean(b.name, 200); if (!n) return res.status(400).json({ error: 'name required' }); add('name', n); }
  if (b.sku !== undefined) add('sku', clean(b.sku, 80));
  if (b.review_link !== undefined) add('review_link', clean(b.review_link, 500));
  if (b.active !== undefined) add('active', !!b.active);
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  try {
    const r = await db.query(
      `UPDATE sp_products SET ${sets.join(', ')} WHERE id = $1 AND seller_id = $2 RETURNING id, name, sku, review_link, active, created_at`,
      params
    );
    if (!r.rowCount) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A product with this name already exists' });
    throw e;
  }
}

// DELETE /api/products/:id
async function remove(req, res) {
  const r = await db.query('DELETE FROM sp_products WHERE id = $1 AND seller_id = $2', [req.params.id, req.auth.seller_id]);
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}

module.exports = { list, create, update, remove };
