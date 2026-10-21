// ============================================================
// Amazon Safety Claims — evidence staging for customer returns.
//   Flow: a return comes in → click photos → but Amazon blocks the claim
//   ("refund not initiated"). We stash the order id + photos here, and later
//   (once the refund is initiated) download the ZIP, upload to Amazon, file the
//   claim, and mark the order as filed.
//
// Storage: images on the VM disk under SAFETY_CLAIMS_DIR (persistent bind mount),
//   NOT publicly served — only via the auth-gated image endpoint. Images are kept
//   for RETENTION_DAYS (2 months) then auto-deleted by cleanupExpired().
// ============================================================
const db = require('../db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.env.SAFETY_CLAIMS_DIR || '/app/data/safety-claims';
const RETENTION_DAYS = parseInt(process.env.SAFETY_CLAIMS_RETENTION_DAYS || '60', 10);
const MAX_IMG_BYTES = 15 * 1024 * 1024;

const safeOrder = (id) => String(id || '').trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64);
const orderDir = (id) => path.join(ROOT, safeOrder(id));

// POST /api/admin/safety-claims   { order_id, notes }
async function createClaim(req, res) {
  const order_id = safeOrder(req.body?.order_id);
  if (!order_id) return res.status(400).json({ error: 'order_id required' });
  const notes = (req.body?.notes || '').toString().slice(0, 2000) || null;
  await db.query(
    `INSERT INTO safety_claims (order_id, notes, created_by) VALUES ($1,$2,$3)
     ON CONFLICT (order_id) DO UPDATE SET notes = COALESCE($2, safety_claims.notes), updated_at = now()`,
    [order_id, notes, req.adminUser?.username || 'admin']
  );
  try { fs.mkdirSync(orderDir(order_id), { recursive: true }); } catch (e) {}
  res.json({ ok: true, order_id });
}

// POST /api/admin/safety-claims/:orderId/images   { filename, contentType, data(base64) }
async function uploadImage(req, res) {
  const order_id = safeOrder(req.params.orderId);
  if (!order_id) return res.status(400).json({ error: 'invalid order' });
  const { data, contentType } = req.body || {};
  if (!data) return res.status(400).json({ error: 'image data (base64) required' });
  const buf = Buffer.from(String(data).replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length) return res.status(400).json({ error: 'empty image' });
  if (buf.length > MAX_IMG_BYTES) return res.status(413).json({ error: 'image too large (max 15 MB)' });
  const ct = (contentType || '').toLowerCase();
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('heic') ? 'heic' : 'jpg';
  try { fs.mkdirSync(orderDir(order_id), { recursive: true }); } catch (e) {}
  const name = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(orderDir(order_id), name), buf);
  await db.query(
    `INSERT INTO safety_claims (order_id, image_count, created_by) VALUES ($1, 1, $2)
     ON CONFLICT (order_id) DO UPDATE
       SET image_count = safety_claims.image_count + 1, images_expired = false, updated_at = now()`,
    [order_id, req.adminUser?.username || 'admin']
  );
  res.json({ ok: true, name });
}

// GET /api/admin/safety-claims?status=pending|filed
async function listClaims(req, res) {
  const status = req.query.status;
  const where = (status === 'pending' || status === 'filed') ? `WHERE status = $1` : '';
  const params = where ? [status] : [];
  const r = await db.query(
    `SELECT order_id, status, image_count, images_expired, notes, created_by, created_at, filed_at,
            (created_at + ($${params.length + 1} || ' days')::interval) AS expires_at
       FROM safety_claims ${where}
      ORDER BY (status='filed'), created_at DESC`,
    [...params, String(RETENTION_DAYS)]
  );
  res.json(r.rows);
}

// GET /api/admin/safety-claims/:orderId/images → filenames present on disk
async function listImages(req, res) {
  const order_id = safeOrder(req.params.orderId);
  let images = [];
  try { images = fs.readdirSync(orderDir(order_id)).filter(f => !f.startsWith('.')); } catch (e) {}
  res.json({ order_id, images });
}

// GET /api/admin/safety-claims/:orderId/image/:name → stream one image
async function getImage(req, res) {
  const order_id = safeOrder(req.params.orderId);
  const name = path.basename(String(req.params.name || ''));   // block traversal
  const dir = orderDir(order_id);
  const fp = path.join(dir, name);
  if (!fp.startsWith(dir + path.sep) || !fs.existsSync(fp)) return res.status(404).json({ error: 'not found' });
  const ext = path.extname(name).slice(1).toLowerCase();
  res.setHeader('Content-Type', ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
  fs.createReadStream(fp).pipe(res);
}

// POST /api/admin/safety-claims/:orderId/file   { filed: true|false }
async function markFiled(req, res) {
  const order_id = safeOrder(req.params.orderId);
  const filed = req.body?.filed !== false;
  await db.query(
    `UPDATE safety_claims SET status = $2, filed_at = ${filed ? 'now()' : 'NULL'}, updated_at = now() WHERE order_id = $1`,
    [order_id, filed ? 'filed' : 'pending']
  );
  console.log(`[SAFETY_CLAIMS] ${order_id} -> ${filed ? 'filed' : 'pending'} by ${req.adminUser?.username || 'admin'}`);
  res.json({ ok: true, order_id, status: filed ? 'filed' : 'pending' });
}

// DELETE /api/admin/safety-claims/:orderId
async function deleteClaim(req, res) {
  const order_id = safeOrder(req.params.orderId);
  try { fs.rmSync(orderDir(order_id), { recursive: true, force: true }); } catch (e) {}
  await db.query(`DELETE FROM safety_claims WHERE order_id = $1`, [order_id]);
  res.json({ ok: true });
}

// Lifecycle: delete images older than RETENTION_DAYS (keeps the claim row for history).
async function cleanupExpired() {
  try {
    const r = await db.query(
      `SELECT order_id FROM safety_claims
        WHERE created_at < now() - ($1 || ' days')::interval AND image_count > 0`,
      [String(RETENTION_DAYS)]
    );
    for (const row of r.rows) {
      try { fs.rmSync(orderDir(row.order_id), { recursive: true, force: true }); } catch (e) {}
      await db.query(`UPDATE safety_claims SET image_count = 0, images_expired = true WHERE order_id = $1`, [row.order_id]).catch(() => {});
    }
    if (r.rowCount) console.log(`[SAFETY_CLAIMS] expired images for ${r.rowCount} order(s)`);
  } catch (e) { console.error('[SAFETY_CLAIMS] cleanup error:', e.message); }
}

module.exports = {
  createClaim, uploadImage, listClaims, listImages, getImage, markFiled, deleteClaim, cleanupExpired,
};
