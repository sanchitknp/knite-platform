// ============================================================
// Knite — Support & Installation controller
// Backs the public /support page (two flows) and the admin tabs.
//   Public:  POST /api/support/installation
//            POST /api/support/ticket
//            GET  /api/support/check-pincode?pincode=######
//   Admin:   GET/PATCH /api/admin/installations[/:id]
//            GET/PATCH /api/admin/tickets[/:id]
// ============================================================
const db = require('../db');
const zoneService = require('../services/zoneService');

// ── helpers ─────────────────────────────────────────────────
const clean = (v) => (typeof v === 'string' ? v.trim() : v) || null;
const normPhone = (p) => (p || '').replace(/[^0-9]/g, '');

/**
 * GET /api/support/check-pincode?pincode=######
 * Tells the installation form whether we currently service a pincode.
 * Never an error path — always 200 with a serviceable flag so the UI can
 * show a friendly note without blocking submission.
 */
async function checkPincode(req, res) {
  const pincode = (req.query.pincode || '').replace(/[^0-9]/g, '');
  if (pincode.length !== 6) {
    return res.json({ ok: false, valid: false, serviceable: false });
  }

  // 1. Is it inside an active service zone? (our 63 live pincodes)
  const zone = await zoneService.findZoneByPincode(pincode);
  if (zone) {
    return res.json({
      ok: true, valid: true, serviceable: true,
      zone_id: zone.id, zone: zone.name, city: zone.city || null,
    });
  }

  // 2. Not serviceable yet — still resolve the place name for a nicer message.
  let city = null, state = null;
  try {
    const r = await db.query(
      `SELECT DISTINCT city, state FROM india_pincodes WHERE pincode = $1 LIMIT 1`,
      [pincode]
    );
    if (r.rows[0]) { city = r.rows[0].city; state = r.rows[0].state; }
  } catch (e) { /* india_pincodes optional — ignore */ }

  res.json({ ok: true, valid: true, serviceable: false, city, state });
}

/**
 * POST /api/support/installation
 * Registers an installation request from the website. Public (no login),
 * but associates the logged-in shop customer if a session is present.
 */
async function createInstallation(req, res) {
  const b = req.body || {};
  const name  = clean(b.name);
  const phone = normPhone(b.phone);
  const serialNo = clean(b.serial_no);
  if (!name)            return res.status(400).json({ error: 'Name is required' });
  if (phone.length < 10) return res.status(400).json({ error: 'A valid phone number is required' });
  if (!clean(b.address) && !clean(b.pincode))
    return res.status(400).json({ error: 'Address or pincode is required' });

  // Resolve serviceability from the pincode (best-effort).
  let zoneId = null, serviceable = null;
  const pincode = (b.pincode || '').replace(/[^0-9]/g, '');
  if (pincode.length === 6) {
    const zone = await zoneService.findZoneByPincode(pincode);
    zoneId = zone ? zone.id : null;
    serviceable = !!zone;
  }

  const lat = Number.isFinite(parseFloat(b.latitude)) ? parseFloat(b.latitude) : null;
  const lng = Number.isFinite(parseFloat(b.longitude)) ? parseFloat(b.longitude) : null;

  const r = await db.query(
    `INSERT INTO installation_requests
       (ref, name, phone, email, product_slug, product_name, serial_no, purchased_from,
        order_ref, address, city, pincode, zone_id, serviceable,
        preferred_date, preferred_slot, notes, source, shop_customer_id,
        latitude, longitude, maps_link)
     VALUES ('KN-INST-' || nextval('installation_ref_seq'),
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'website',$17,$18,$19,$20)
     RETURNING ref, id, created_at`,
    [
      name, phone, clean(b.email),
      clean(b.product_slug), clean(b.product_name), serialNo, clean(b.purchased_from),
      clean(b.order_ref), clean(b.address), clean(b.city), pincode || null,
      zoneId, serviceable,
      clean(b.preferred_date), clean(b.preferred_slot), clean(b.notes),
      req.shopCustomer?.id || null,
      lat, lng, clean(b.maps_link),
    ]
  );

  const row = r.rows[0];
  console.log(`[SUPPORT INSTALL] ${row.ref} name=${name} phone=${phone} serial=${serialNo} pincode=${pincode || '–'} serviceable=${serviceable}`);
  res.json({ ok: true, ref: row.ref, serviceable });
}

/**
 * POST /api/support/ticket
 * Raises a support ticket from the website. Public (no login).
 */
async function createTicket(req, res) {
  const b = req.body || {};
  const name    = clean(b.name);
  const phone   = normPhone(b.phone);
  const category = clean(b.category);
  const subject = clean(b.subject);
  const description = clean(b.description);
  const serialNo = clean(b.serial_no);
  if (!name)        return res.status(400).json({ error: 'Name is required' });
  if (phone.length < 10) return res.status(400).json({ error: 'A valid phone number is required' });
  if (!category)    return res.status(400).json({ error: 'Please choose a category' });
  if (!subject)     return res.status(400).json({ error: 'Subject is required' });
  if (!description) return res.status(400).json({ error: 'Please describe the issue' });

  const r = await db.query(
    `INSERT INTO support_tickets
       (ref, name, phone, email, category, serial_no, product_slug, product_name,
        order_ref, subject, description, city, pincode, source, shop_customer_id)
     VALUES ('KN-TKT-' || nextval('ticket_ref_seq'),
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'website',$13)
     RETURNING ref, id, created_at`,
    [
      name, phone, clean(b.email), category, serialNo,
      clean(b.product_slug), clean(b.product_name), clean(b.order_ref),
      subject, description, clean(b.city),
      (b.pincode || '').replace(/[^0-9]/g, '') || null,
      req.shopCustomer?.id || null,
    ]
  );

  const row = r.rows[0];
  console.log(`[SUPPORT TICKET] ${row.ref} name=${name} phone=${phone} category=${category} serial=${serialNo}`);
  res.json({ ok: true, ref: row.ref });
}

// ── ADMIN ───────────────────────────────────────────────────
async function adminListInstallations(req, res) {
  const { status, limit = 200 } = req.query;
  const where = status ? `WHERE i.status = $1` : '';
  const params = status ? [status] : [];
  const r = await db.query(
    `SELECT i.*, z.name AS zone_name,
            a.tech_name  AS assigned_tech_name,
            a.tech_phone AS assigned_tech_phone,
            a.assigned_at,
            a.assigned_by
       FROM installation_requests i
       LEFT JOIN zones z ON z.id = i.zone_id
       LEFT JOIN LATERAL (
         SELECT tech_name, tech_phone, assigned_at, assigned_by
           FROM installation_assignments aa
          WHERE aa.installation_id = i.id
          ORDER BY aa.assigned_at DESC
          LIMIT 1
       ) a ON true
       ${where}
       ORDER BY i.created_at DESC
       LIMIT ${parseInt(limit)}`,
    params
  );
  res.json(r.rows);
}

// Assign a technician (registered tech or RO service lead) to an installation request.
async function assignInstallationTechnician(req, res) {
  const installId = req.params.id;
  const b = req.body || {};
  const techName = clean(b.tech_name);
  if (!techName) return res.status(400).json({ error: 'Technician name is required' });

  const inst = await db.query(`SELECT * FROM installation_requests WHERE id = $1`, [installId]);
  if (!inst.rowCount) return res.status(404).json({ error: 'Installation request not found' });
  const I = inst.rows[0];

  const r = await db.query(
    `INSERT INTO installation_assignments
       (installation_id, installation_ref, place_id, tech_name, tech_phone,
        tech_address, tech_city, source, assigned_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, tech_name, tech_phone, assigned_by, assigned_at`,
    [
      installId, I.ref, clean(b.place_id), techName, clean(b.tech_phone),
      clean(b.tech_address), clean(b.tech_city), clean(b.source),
      req.adminUser?.username || 'admin',
    ]
  );
  // Once a technician is assigned, move the request to 'scheduled' (unless already installed/cancelled).
  await db.query(
    `UPDATE installation_requests SET status = 'scheduled'
      WHERE id = $1 AND status IN ('new','contacted')`,
    [installId]
  );

  // Build a pre-filled WhatsApp message to the technician with the customer's details.
  let waNum = (clean(b.tech_phone) || '').replace(/\D/g, '');
  if (waNum.length === 10) waNum = '91' + waNum;
  const pdate = I.preferred_date ? new Date(I.preferred_date).toISOString().slice(0, 10) : '';
  const loc = I.maps_link
    || (I.latitude && I.longitude ? `https://maps.google.com/?q=${I.latitude},${I.longitude}` : '');
  const addr = I.address
    ? `${I.address}${I.city ? ', ' + I.city : ''}${I.pincode ? ' - ' + I.pincode : ''}`
    : (I.pincode ? I.pincode : '');
  const message = [
    `*Knite — New Installation Request ${I.ref}*`,
    '',
    `Customer: ${I.name}`,
    `Phone: ${I.phone}`,
    addr ? `Address: ${addr}` : '',
    loc ? `Location: ${loc}` : '',
    (pdate || I.preferred_slot) ? `Preferred: ${[pdate, I.preferred_slot].filter(Boolean).join(' ')}` : '',
    I.product_name ? `Product: ${I.product_name}` : '',
    I.serial_no ? `Serial: ${I.serial_no}` : '',
    I.notes ? `Notes: ${I.notes}` : '',
    '',
    `Please confirm if you can take this installation. — Team Knite`,
  ].filter(Boolean).join('\n');
  const whatsapp_url = waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent(message)}` : null;

  console.log(`[SUPPORT ASSIGN] ${I.ref} -> ${techName} (${clean(b.tech_phone) || '–'}) by ${req.adminUser?.username || 'admin'}`);
  res.json({ ok: true, assignment: r.rows[0], whatsapp_url });
}

async function adminUpdateInstallation(req, res) {
  const { status, admin_notes } = req.body;
  await db.query(
    `UPDATE installation_requests
        SET status = COALESCE($1, status),
            admin_notes = COALESCE($2, admin_notes),
            updated_at = now()
      WHERE id = $3`,
    [status || null, admin_notes || null, req.params.id]
  );
  res.json({ ok: true });
}

async function adminListTickets(req, res) {
  const { status, limit = 200 } = req.query;
  const where = status ? `WHERE status = $1` : '';
  const params = status ? [status] : [];
  const r = await db.query(
    `SELECT * FROM support_tickets ${where} ORDER BY created_at DESC LIMIT ${parseInt(limit)}`,
    params
  );
  res.json(r.rows);
}

async function adminUpdateTicket(req, res) {
  const { status, priority, admin_notes } = req.body;
  await db.query(
    `UPDATE support_tickets
        SET status = COALESCE($1, status),
            priority = COALESCE($2, priority),
            admin_notes = COALESCE($3, admin_notes),
            updated_at = now()
      WHERE id = $4`,
    [status || null, priority || null, admin_notes || null, req.params.id]
  );
  res.json({ ok: true });
}

/**
 * GET /api/admin/installations/:id/technicians
 * For an installation request, list who can service its pincode:
 *   - Registered technicians whose zone covers the exact pincode, or a nearby
 *     zone (same 3-digit sorting-district prefix).
 *   - RO service providers (ro_service_leads) at the exact pincode, then nearby
 *     (same zone pincodes / prefix), ranked by rating — the wider dispatch pool.
 */
async function getInstallationTechnicians(req, res) {
  const reqR = await db.query(
    `SELECT i.ref, i.pincode, i.serviceable, i.zone_id,
            z.name AS zone_name, z.pincodes AS zone_pincodes
       FROM installation_requests i
       LEFT JOIN zones z ON z.id = i.zone_id
      WHERE i.id = $1`,
    [req.params.id]
  );
  const ir = reqR.rows[0];
  if (!ir) return res.status(404).json({ error: 'Installation request not found' });

  const pincode = (ir.pincode || '').replace(/[^0-9]/g, '') || null;
  const prefix = pincode ? pincode.slice(0, 3) : null;
  const zonePincodes = (ir.zone_pincodes && ir.zone_pincodes.length) ? ir.zone_pincodes : null;

  let technicians = [], partners = [];

  if (pincode) {
    // 1) Registered technicians — exact zone or nearby (same 3-digit prefix)
    const t = await db.query(
      `SELECT t.id, t.name, t.phone, t.rating, t.jobs_completed,
              bool_or($1 = ANY(z.pincodes)) AS serves_exact,
              array_agg(DISTINCT z.name) AS zones,
              bool_or(tz.is_home) AS is_home
         FROM technicians t
         JOIN technician_zones tz ON tz.technician_id = t.id
         JOIN zones z ON z.id = tz.zone_id AND z.is_active = true
        WHERE t.is_active = true AND t.is_verified = true
        GROUP BY t.id
       HAVING bool_or($1 = ANY(z.pincodes))
           OR bool_or(EXISTS (SELECT 1 FROM unnest(z.pincodes) p WHERE left(p, 3) = $2))
        ORDER BY bool_or($1 = ANY(z.pincodes)) DESC, bool_or(tz.is_home) DESC, t.rating DESC NULLS LAST`,
      [pincode, prefix]
    );
    technicians = t.rows.map(r => ({
      id: r.id, name: r.name, phone: r.phone, rating: r.rating,
      jobs_completed: r.jobs_completed, zones: r.zones, is_home: r.is_home,
      match: r.serves_exact ? 'exact' : 'nearby',
    }));

    // 2) Service providers (ro_service_leads) — exact pincode, then nearby
    const cols = `id, business_name, phone, intl_phone, full_address, city, pincode, rating, total_ratings, google_maps_link`;
    const exact = await db.query(
      `SELECT ${cols} FROM ro_service_leads
        WHERE pincode = $1 AND business_status = 'OPERATIONAL'
        ORDER BY rating DESC NULLS LAST, total_ratings DESC NULLS LAST LIMIT 8`,
      [pincode]
    );
    const nearby = await db.query(
      `SELECT ${cols} FROM ro_service_leads
        WHERE business_status = 'OPERATIONAL' AND pincode <> $1
          AND ( ($2::text[] IS NOT NULL AND pincode = ANY($2)) OR left(pincode, 3) = $3 )
        ORDER BY rating DESC NULLS LAST, total_ratings DESC NULLS LAST LIMIT 15`,
      [pincode, zonePincodes, prefix]
    );
    partners = [
      ...exact.rows.map(r => ({ ...r, match: 'exact' })),
      ...nearby.rows.map(r => ({ ...r, match: 'nearby' })),
    ];
  }

  res.json({
    request: { ref: ir.ref, pincode, zone: ir.zone_name || null, serviceable: ir.serviceable },
    technicians,
    partners,
  });
}

module.exports = {
  checkPincode,
  createInstallation,
  createTicket,
  adminListInstallations,
  adminUpdateInstallation,
  assignInstallationTechnician,
  getInstallationTechnicians,
  adminListTickets,
  adminUpdateTicket,
};
