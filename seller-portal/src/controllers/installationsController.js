// Installations — list/create/update, scoped by seller_id. Richer features
// (nearest technician, assignment, reviews) come in the service suite.
const db = require('../db');
const geocoder = require('../services/geocoder');

const clean = (v, n = 500) => (v == null ? null : String(v).trim().slice(0, n) || null);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const STATUSES = ['pending', 'scheduled', 'installed', 'cancelled'];

// GET /api/installations?status=&q=
async function list(req, res) {
  const sid = req.auth.seller_id;
  const params = [sid];
  let where = 'i.seller_id = $1';
  if (STATUSES.includes(req.query.status)) { params.push(req.query.status); where += ` AND i.status = $${params.length}`; }
  if (req.query.q) { params.push(`%${String(req.query.q).trim()}%`); where += ` AND (i.customer_name ILIKE $${params.length} OR i.customer_phone ILIKE $${params.length} OR i.product_name ILIKE $${params.length} OR i.order_id ILIKE $${params.length})`; }
  const r = await db.query(
    `SELECT i.id, i.customer_name, i.customer_phone, i.customer_email, i.address, i.city, i.pincode,
            i.maps_link, i.latitude, i.longitude, i.product_name, i.purchased_from, i.order_id, i.marketplace,
            i.status, i.preferred_date, i.preferred_slot, i.notes, i.source,
            i.assigned_tech_name, i.assigned_tech_phone, i.assigned_at, i.review_requested_at, i.created_at,
            p.review_link
       FROM sp_installations i
       LEFT JOIN sp_products p ON p.seller_id = i.seller_id AND p.name = i.product_name
      WHERE ${where}
      ORDER BY (i.status IN ('installed','cancelled')), i.created_at DESC LIMIT 500`,
    params
  );
  res.json(r.rows);
}

// POST /api/installations  (staff manual entry)
async function create(req, res) {
  const sid = req.auth.seller_id;
  const b = req.body || {};
  const customer_name = clean(b.customer_name, 120);
  if (!customer_name) return res.status(400).json({ error: 'customer name required' });
  const lat = (b.latitude === '' || b.latitude == null || isNaN(Number(b.latitude))) ? null : Number(b.latitude);
  const lng = (b.longitude === '' || b.longitude == null || isNaN(Number(b.longitude))) ? null : Number(b.longitude);
  const r = await db.query(
    `INSERT INTO sp_installations
       (seller_id, customer_name, customer_phone, customer_email, address, city, pincode,
        product_name, purchased_from, order_id, marketplace, maps_link, latitude, longitude, geo_source,
        preferred_date, preferred_slot, notes, status, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending','portal') RETURNING *`,
    [sid, customer_name, clean(b.customer_phone, 20), clean(b.customer_email, 120), clean(b.address, 500),
     clean(b.city, 80), clean(b.pincode, 10), clean(b.product_name, 200), clean(b.purchased_from, 30),
     clean(b.order_id, 80), clean(b.marketplace, 20), clean(b.maps_link, 500), lat, lng,
     (lat != null && lng != null) ? 'pin' : null,
     isDate(b.preferred_date) ? b.preferred_date : null, clean(b.preferred_slot, 40), clean(b.notes, 2000)]
  );
  res.json(r.rows[0]);
}

// PATCH /api/installations/:id  { status?, notes?, preferred_date?, preferred_slot? }
async function update(req, res) {
  const sid = req.auth.seller_id;
  const b = req.body || {};
  const sets = []; const params = [req.params.id, sid];
  const add = (c, v) => { params.push(v); sets.push(`${c} = $${params.length}`); };
  if (b.status && STATUSES.includes(b.status)) add('status', b.status);
  if (b.notes !== undefined) add('notes', clean(b.notes, 2000));
  if (b.preferred_date !== undefined) add('preferred_date', isDate(b.preferred_date) ? b.preferred_date : null);
  if (b.preferred_slot !== undefined) add('preferred_slot', clean(b.preferred_slot, 40));
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  sets.push('updated_at = now()');
  const r = await db.query(
    `UPDATE sp_installations SET ${sets.join(', ')} WHERE id = $1 AND seller_id = $2 RETURNING *`,
    params
  );
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  res.json(r.rows[0]);
}

// GET /api/installations/:id/nearest-technicians
// Resolves the installation's location, then returns nearest technicians from the
// shared RO directory + the seller's own roster, sorted by distance.
async function nearest(req, res) {
  const sid = req.auth.seller_id;
  const inst = (await db.query(
    'SELECT id, address, city, pincode, latitude, longitude, geo_source FROM sp_installations WHERE id = $1 AND seller_id = $2',
    [req.params.id, sid]
  )).rows[0];
  if (!inst) return res.status(404).json({ error: 'not found' });

  const loc = await geocoder.resolveLocation(inst);
  if (!loc) {
    return res.status(422).json({
      error: 'Could not determine a location for this installation. Add a pincode or a Google Maps location, then try again.',
    });
  }
  const { lat, lng } = loc;
  const box = 0.9; // ~100 km pre-filter for speed
  const HAV = `(6371*acos(LEAST(1, cos(radians($1))*cos(radians(latitude))*cos(radians(longitude)-radians($2))+sin(radians($1))*sin(radians(latitude)))))`;

  const [dir, cus] = await Promise.all([
    db.query(
      `SELECT place_id, business_name AS name, phone, city, rating, ${HAV} AS distance_km
         FROM ro_service_leads
        WHERE latitude IS NOT NULL AND phone IS NOT NULL
          AND latitude BETWEEN $1-$3 AND $1+$3 AND longitude BETWEEN $2-$3 AND $2+$3
        ORDER BY distance_km ASC LIMIT 12`,
      [lat, lng, box]
    ),
    db.query(
      `SELECT id::text AS technician_id, name, phone, city, NULL::numeric AS rating, ${HAV} AS distance_km
         FROM sp_technicians
        WHERE seller_id = $4 AND active AND latitude IS NOT NULL
          AND latitude BETWEEN $1-$3 AND $1+$3 AND longitude BETWEEN $2-$3 AND $2+$3
        ORDER BY distance_km ASC LIMIT 12`,
      [lat, lng, box, sid]
    ),
  ]);

  const techs = [
    ...cus.rows.map(r => ({ source: 'custom', ...r, distance_km: Number(r.distance_km) })),
    ...dir.rows.map(r => ({ source: 'directory', ...r, distance_km: Number(r.distance_km) })),
  ].sort((a, b) => a.distance_km - b.distance_km).slice(0, 15);

  res.json({ location: loc, technicians: techs });
}

// POST /api/installations/:id/assign  { tech_name, tech_phone, tech_source, place_id?, distance_km?, save_to_roster? }
async function assign(req, res) {
  const sid = req.auth.seller_id;
  const b = req.body || {};
  const inst = (await db.query('SELECT id FROM sp_installations WHERE id = $1 AND seller_id = $2', [req.params.id, sid])).rows[0];
  if (!inst) return res.status(404).json({ error: 'not found' });
  const tech_name = clean(b.tech_name, 120);
  const tech_phone = clean(b.tech_phone, 20);
  if (!tech_name) return res.status(400).json({ error: 'technician name required' });
  const source = ['directory', 'custom', 'manual'].includes(b.tech_source) ? b.tech_source : 'manual';
  const dist = (b.distance_km == null || isNaN(Number(b.distance_km))) ? null : Number(b.distance_km);

  await db.query(
    `INSERT INTO sp_installation_assignments
       (installation_id, seller_id, tech_name, tech_phone, tech_source, place_id, distance_km, assigned_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'assigned')`,
    [inst.id, sid, tech_name, tech_phone, source, clean(b.place_id, 120), dist, req.auth.user_id]
  );
  if (b.save_to_roster && tech_phone) {
    await db.query(
      `INSERT INTO sp_technicians (seller_id, name, phone, city) VALUES ($1,$2,$3,$4)
       ON CONFLICT (seller_id, phone) DO UPDATE SET name = EXCLUDED.name`,
      [sid, tech_name, tech_phone, clean(b.city, 80)]
    ).catch(() => {});
  }
  await db.query(
    `UPDATE sp_installations
        SET assigned_tech_name = $3, assigned_tech_phone = $4, assigned_at = now(),
            status = CASE WHEN status = 'pending' THEN 'scheduled' ELSE status END,
            updated_at = now()
      WHERE id = $1 AND seller_id = $2`,
    [inst.id, sid, tech_name, tech_phone]
  );
  res.json({ ok: true });
}

// POST /api/installations/:id/review-request — stamp that a review request was sent.
// (The WhatsApp message itself is opened client-side via wa.me.)
async function reviewRequest(req, res) {
  const r = await db.query(
    'UPDATE sp_installations SET review_requested_at = now(), updated_at = now() WHERE id = $1 AND seller_id = $2 RETURNING id',
    [req.params.id, req.auth.seller_id]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}

module.exports = { list, create, update, nearest, assign, reviewRequest };
