// Module C — Safety Claims (Amazon SAFE-T evidence staging).
// Adapted from Knite's proven engine, made multi-tenant: images live under
// <ROOT>/<seller_id>/<order_id>/ and every row/path is scoped by seller_id.
const db = require('../db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.env.SSP_DATA_DIR
  ? path.join(process.env.SSP_DATA_DIR, 'safety-claims')
  : '/app/data/ssp/safety-claims';
const RETENTION_DAYS = parseInt(process.env.SSP_SAFETY_RETENTION_DAYS || '60', 10);
const MAX_IMG_BYTES = 15 * 1024 * 1024;

const safeId = (id) => String(id || '').trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64);
// seller_id is a uuid from the verified token — keep only uuid-safe chars.
const safeSeller = (id) => String(id || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
const claimDir = (sid, order) => path.join(ROOT, safeSeller(sid), safeId(order));

// POST /api/safety-claims { order_id, reason, amount_claimed, notes }
async function createClaim(req, res) {
  const sid = req.auth.seller_id;
  const order_id = safeId(req.body?.order_id);
  if (!order_id) return res.status(400).json({ error: 'order_id required' });
  const reason = (req.body?.reason || '').toString().slice(0, 120) || null;
  const notes = (req.body?.notes || '').toString().slice(0, 2000) || null;
  const amount = req.body?.amount_claimed != null && !isNaN(Number(req.body.amount_claimed))
    ? Number(req.body.amount_claimed) : null;
  await db.query(
    `INSERT INTO sp_safety_claims (seller_id, order_id, reason, amount_claimed, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (seller_id, order_id) DO UPDATE
       SET reason = COALESCE($3, sp_safety_claims.reason),
           amount_claimed = COALESCE($4, sp_safety_claims.amount_claimed),
           notes = COALESCE($5, sp_safety_claims.notes),
           updated_at = now()`,
    [sid, order_id, reason, amount, notes, req.auth.email || 'seller']
  );
  try { fs.mkdirSync(claimDir(sid, order_id), { recursive: true }); } catch (e) {}
  res.json({ ok: true, order_id });
}

// POST /api/safety-claims/:orderId/images { data(base64), contentType }
async function uploadImage(req, res) {
  const sid = req.auth.seller_id;
  const order_id = safeId(req.params.orderId);
  if (!order_id) return res.status(400).json({ error: 'invalid order' });
  const { data, contentType } = req.body || {};
  if (!data) return res.status(400).json({ error: 'image data (base64) required' });
  const buf = Buffer.from(String(data).replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length) return res.status(400).json({ error: 'empty image' });
  if (buf.length > MAX_IMG_BYTES) return res.status(413).json({ error: 'image too large (max 15 MB)' });
  const ct = (contentType || '').toLowerCase();
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('heic') ? 'heic' : 'jpg';
  try { fs.mkdirSync(claimDir(sid, order_id), { recursive: true }); } catch (e) {}
  const name = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(claimDir(sid, order_id), name), buf);
  await db.query(
    `INSERT INTO sp_safety_claims (seller_id, order_id, image_count, created_by)
     VALUES ($1,$2,1,$3)
     ON CONFLICT (seller_id, order_id) DO UPDATE
       SET image_count = sp_safety_claims.image_count + 1, images_expired = false, updated_at = now()`,
    [sid, order_id, req.auth.email || 'seller']
  );
  res.json({ ok: true, name });
}

// GET /api/safety-claims?status=pending|filed
async function listClaims(req, res) {
  const sid = req.auth.seller_id;
  const params = [sid];
  let where = 'seller_id = $1';
  if (['pending', 'filed', 'approved', 'rejected', 'closed'].includes(req.query.status)) {
    params.push(req.query.status); where += ` AND status = $${params.length}`;
  }
  params.push(String(RETENTION_DAYS));
  const r = await db.query(
    `SELECT order_id, marketplace, status, image_count, images_expired, reason, amount_claimed,
            notes, created_by, created_at, filed_at,
            (created_at + ($${params.length} || ' days')::interval) AS expires_at
       FROM sp_safety_claims WHERE ${where}
      ORDER BY (status='filed'), created_at DESC`,
    params
  );
  res.json(r.rows);
}

// GET /api/safety-claims/:orderId/images
async function listImages(req, res) {
  const sid = req.auth.seller_id;
  const order_id = safeId(req.params.orderId);
  let images = [];
  try { images = fs.readdirSync(claimDir(sid, order_id)).filter(f => !f.startsWith('.')); } catch (e) {}
  res.json({ order_id, images });
}

// GET /api/safety-claims/:orderId/image/:name
async function getImage(req, res) {
  const sid = req.auth.seller_id;
  const order_id = safeId(req.params.orderId);
  const name = path.basename(String(req.params.name || ''));
  const dir = claimDir(sid, order_id);
  const fp = path.join(dir, name);
  if (!fp.startsWith(dir + path.sep) || !fs.existsSync(fp)) return res.status(404).json({ error: 'not found' });
  const ext = path.extname(name).slice(1).toLowerCase();
  res.setHeader('Content-Type', ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
  fs.createReadStream(fp).pipe(res);
}

// POST /api/safety-claims/:orderId/file { filed: true|false }
async function markFiled(req, res) {
  const sid = req.auth.seller_id;
  const order_id = safeId(req.params.orderId);
  const filed = req.body?.filed !== false;
  const r = await db.query(
    `UPDATE sp_safety_claims SET status = $3, filed_at = ${filed ? 'now()' : 'NULL'}, updated_at = now()
      WHERE seller_id = $1 AND order_id = $2`,
    [sid, order_id, filed ? 'filed' : 'pending']
  );
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, order_id, status: filed ? 'filed' : 'pending' });
}

// PATCH /api/safety-claims/:orderId { new_order_id }
async function renameClaim(req, res) {
  const sid = req.auth.seller_id;
  const oldId = safeId(req.params.orderId);
  const newId = safeId(req.body?.new_order_id || req.body?.order_id);
  if (!newId) return res.status(400).json({ error: 'new_order_id required' });
  if (newId === oldId) return res.json({ ok: true, order_id: newId });
  const clash = await db.query('SELECT 1 FROM sp_safety_claims WHERE seller_id = $1 AND order_id = $2', [sid, newId]);
  if (clash.rowCount) return res.status(409).json({ error: 'A claim with that order id already exists' });
  try {
    const src = claimDir(sid, oldId), dst = claimDir(sid, newId);
    if (fs.existsSync(src)) fs.renameSync(src, dst);
  } catch (e) { console.error('[SAFETY] rename dir failed:', e.message); }
  const r = await db.query(
    `UPDATE sp_safety_claims SET order_id = $3, updated_at = now() WHERE seller_id = $1 AND order_id = $2 RETURNING order_id`,
    [sid, oldId, newId]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'claim not found' });
  res.json({ ok: true, order_id: newId });
}

// DELETE /api/safety-claims/:orderId
async function deleteClaim(req, res) {
  const sid = req.auth.seller_id;
  const order_id = safeId(req.params.orderId);
  try { fs.rmSync(claimDir(sid, order_id), { recursive: true, force: true }); } catch (e) {}
  await db.query('DELETE FROM sp_safety_claims WHERE seller_id = $1 AND order_id = $2', [sid, order_id]);
  res.json({ ok: true });
}

// Lifecycle: delete images older than RETENTION_DAYS across all sellers.
async function cleanupExpired() {
  try {
    const r = await db.query(
      `SELECT seller_id, order_id FROM sp_safety_claims
        WHERE created_at < now() - ($1 || ' days')::interval AND image_count > 0`,
      [String(RETENTION_DAYS)]
    );
    for (const row of r.rows) {
      try { fs.rmSync(claimDir(row.seller_id, row.order_id), { recursive: true, force: true }); } catch (e) {}
      await db.query(
        'UPDATE sp_safety_claims SET image_count = 0, images_expired = true WHERE seller_id = $1 AND order_id = $2',
        [row.seller_id, row.order_id]
      ).catch(() => {});
    }
    if (r.rowCount) console.log(`[SAFETY] expired images for ${r.rowCount} claim(s)`);
  } catch (e) { console.error('[SAFETY] cleanup error:', e.message); }
}

module.exports = {
  createClaim, uploadImage, listClaims, listImages, getImage, markFiled, renameClaim, deleteClaim, cleanupExpired,
};
