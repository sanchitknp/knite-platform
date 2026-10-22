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
const wa = require('../services/whatsappService');
const geocoder = require('../services/geocoder');
const translator = require('../services/translateService');

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

  if (lat != null && lng != null) {
    // Customer dropped a precise map pin.
    db.query(`UPDATE installation_requests SET geo_source='pin' WHERE id=$1`, [row.id]).catch(() => {});
  } else {
    // No pin → derive approximate coordinates from the typed address IN THE BACKGROUND
    // (never blocks the customer's form). The admin sees the pin a second or two later.
    geocoder
      .geocodeInstallation({ address: clean(b.address), city: clean(b.city), pincode })
      .then((g) => {
        if (!g) return;
        return db
          .query(
            `UPDATE installation_requests
                SET latitude=$1, longitude=$2, geo_source=$3
              WHERE id=$4 AND latitude IS NULL`,
            [g.latitude, g.longitude, g.geo_source, row.id]
          )
          .then(() => console.log(`[GEOCODE] ${row.ref} -> ${g.latitude},${g.longitude} (${g.geo_source}/${g.precision})`));
      })
      .catch((e) => console.error(`[GEOCODE] ${row.ref} failed:`, e.message));
  }

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

// ── VOICE-AGENT WEBHOOKS (Servum AI) ─────────────────────────
// Public endpoints the voice agent calls. Auth via ?key= or x-webhook-key header.
function voiceKeyOk(req) {
  const k = req.query.key || req.headers['x-webhook-key'];
  return !!process.env.WEBHOOK_VOICE_KEY && k === process.env.WEBHOOK_VOICE_KEY;
}

// POST /api/webhooks/voice   { type: "installation" | "support_ticket", whatsapp_number|phone, ... }
// Single endpoint; `type` decides whether an installation request or a support ticket is created.
async function voiceWebhook(req, res) {
  if (!voiceKeyOk(req)) return res.status(401).json({ error: 'unauthorized' });
  const b = req.body || {};
  const type = String(b.type || '').toLowerCase().replace(/[^a-z]/g, '');
  const phone = normPhone(b.whatsapp_number || b.phone || b.mobile || b.whatsapp);
  if (phone.length < 10) return res.status(400).json({ error: 'whatsapp_number (or phone) is required' });
  const name = clean(b.name || b.customer_name) || 'Voice caller';

  if (['installation', 'install', 'installationrequest'].includes(type)) {
    const notes = ['Installation request via voice agent.',
      b.delivered != null ? 'Delivered: ' + b.delivered : '',
      clean(b.delivered_when) ? 'When: ' + clean(b.delivered_when) : '',
      clean(b.notes)].filter(Boolean).join(' ');
    const r = await db.query(
      `INSERT INTO installation_requests (ref, name, phone, order_ref, notes, source)
       VALUES ('KN-INST-' || nextval('installation_ref_seq'), $1,$2,$3,$4,'voice-agent')
       RETURNING ref, id`,
      [name, phone, clean(b.order_id || b.amazon_order_id), notes]
    );
    console.log(`[VOICE WEBHOOK] installation ${r.rows[0].ref} phone=${phone}`);
    return res.json({ ok: true, type: 'installation', ref: r.rows[0].ref, id: r.rows[0].id });
  }

  if (['supportticket', 'support', 'ticket', 'service', 'servicerequest'].includes(type)) {
    const problem = clean(b.problem || b.issue || b.description) || 'Reported via voice agent (no detail captured).';
    const model = clean(b.model || b.product || b.product_name);
    const r = await db.query(
      `INSERT INTO support_tickets (ref, name, phone, category, product_name, subject, description, source)
       VALUES ('KN-TKT-' || nextval('ticket_ref_seq'), $1,$2,'other',$3,$4,$5,'voice-agent')
       RETURNING ref, id`,
      [name, phone, model, model ? (model + ' — reported via voice') : 'Voice support request', problem]
    );
    console.log(`[VOICE WEBHOOK] ticket ${r.rows[0].ref} phone=${phone} model=${model || '-'}`);
    return res.json({ ok: true, type: 'support_ticket', ref: r.rows[0].ref, id: r.rows[0].id });
  }

  return res.status(400).json({ error: 'type must be "installation" or "support_ticket"' });
}

// ── ADMIN ───────────────────────────────────────────────────
async function adminListInstallations(req, res) {
  const { status, limit = 200 } = req.query;
  // 'active' = the default view: everything except completed/cancelled.
  let where = '';
  const params = [];
  if (status === 'active') {
    where = `WHERE i.status IN ('new','contacted','scheduled')`;
  } else if (status) {
    where = `WHERE i.status = $1`;
    params.push(status);
  }
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

  // Installation charges are entered by the admin at assign time: save them so the
  // technician message carries them AND the later customer notification reuses them.
  const charge = (clean(b.installation_charge) || '').replace(/[^0-9.]/g, '');
  if (charge) {
    await db.query(`UPDATE installation_requests SET installation_charge = $1 WHERE id = $2`, [charge, installId]);
  }

  // If this was a manually-entered ("custom") technician, also keep them in the
  // custom_technicians roster (deduped by canonical phone) for reuse/lookup later.
  if (clean(b.source) === 'custom') {
    let canon = (clean(b.tech_phone) || '').replace(/\D/g, '');
    if (canon.length === 10) canon = '91' + canon;
    if (canon) {
      try {
        await db.query(
          `INSERT INTO custom_technicians (name, phone, raw_phone, city, address, added_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (phone) DO UPDATE
             SET name             = COALESCE(NULLIF(EXCLUDED.name, ''), custom_technicians.name),
                 raw_phone        = EXCLUDED.raw_phone,
                 city             = COALESCE(NULLIF(EXCLUDED.city, ''), custom_technicians.city),
                 address          = COALESCE(NULLIF(EXCLUDED.address, ''), custom_technicians.address),
                 times_assigned   = custom_technicians.times_assigned + 1,
                 last_assigned_at = now()`,
          [techName, canon, clean(b.tech_phone), clean(b.tech_city), clean(b.tech_address),
           req.adminUser?.username || 'admin']
        );
      } catch (e) {
        console.error('[CUSTOM_TECH] roster upsert failed:', e.message);
      }
    }
  }

  // Build a pre-filled WhatsApp message to the technician with the customer's details.
  let waNum = (clean(b.tech_phone) || '').replace(/\D/g, '');
  if (waNum.length === 10) waNum = '91' + waNum;
  const pdate = I.preferred_date ? new Date(I.preferred_date).toISOString().slice(0, 10) : '';
  const loc = I.maps_link
    || (I.latitude && I.longitude ? `https://maps.google.com/?q=${I.latitude},${I.longitude}` : '');
  const addr = I.address
    ? `${I.address}${I.city ? ', ' + I.city : ''}${I.pincode ? ' - ' + I.pincode : ''}`
    : (I.pincode ? I.pincode : '');
  let message = [
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
    charge ? `Installation charges: ₹${charge}` : '',
    '',
    `Please confirm if you can take this installation. — Team Knite`,
  ].filter(Boolean).join('\n');
  // Optionally translate the whole message into the admin-chosen language (best-effort).
  message = await translator.translate(message, clean(b.lang));
  // The admin sends the details manually via WhatsApp (reliable, no first-contact
  // throttle): we always return a wa.me link pre-filled with the customer's details.
  const whatsapp_url = waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent(message)}` : null;

  console.log(`[SUPPORT ASSIGN] ${I.ref} -> ${techName} (${clean(b.tech_phone) || '–'}) by ${req.adminUser?.username || 'admin'}`);
  res.json({ ok: true, assignment: r.rows[0], whatsapp_url });
}

// Admin: translate a WhatsApp message body into a chosen language (best-effort).
async function translateMessage(req, res) {
  const text = (req.body && req.body.text) || '';
  const lang = (req.body && req.body.lang) || '';
  if (!text) return res.status(400).json({ error: 'text required' });
  const translated = await translator.translate(text, lang);
  res.json({ ok: true, text: translated, lang });
}

async function adminUpdateInstallation(req, res) {
  const { status, admin_notes, installation_charge, product_slug, product_name } = req.body;
  const charge = (installation_charge === undefined || installation_charge === null || installation_charge === '')
    ? null
    : String(installation_charge).replace(/[^0-9.]/g, '') || null;
  await db.query(
    `UPDATE installation_requests
        SET status = COALESCE($1, status),
            admin_notes = COALESCE($2, admin_notes),
            installation_charge = COALESCE($3, installation_charge),
            product_slug = COALESCE($4, product_slug),
            product_name = COALESCE($5, product_name),
            updated_at = now()
      WHERE id = $6`,
    [status || null, admin_notes || null, charge, clean(product_slug), clean(product_name), req.params.id]
  );
  res.json({ ok: true });
}

// Admin: record that a WhatsApp communication was sent (state tracking per installation).
async function logCommunication(req, res) {
  const type = (req.body && req.body.type) || '';
  const col = { notify: 'notified_at', ask_status: 'status_asked_at', review: 'review_sent_at' }[type];
  if (!col) return res.status(400).json({ error: 'invalid communication type' });
  await db.query(
    `UPDATE installation_requests SET ${col} = now(), updated_at = now() WHERE id = $1`,
    [req.params.id]
  );
  console.log(`[SUPPORT COMM] ${req.params.id} ${type} by ${req.adminUser?.username || 'admin'}`);
  res.json({ ok: true, type, at: new Date().toISOString() });
}

// Admin: on-demand geocode an installation's typed address → store approx coords.
// Used for requests submitted without a map pin (or where a prior geocode failed).
async function geocodeInstallationRequest(req, res) {
  const inst = await db.query(
    `SELECT id, ref, address, city, pincode FROM installation_requests WHERE id = $1`,
    [req.params.id]
  );
  if (!inst.rowCount) return res.status(404).json({ error: 'Installation request not found' });
  const I = inst.rows[0];
  const g = await geocoder.geocodeInstallation({ address: I.address, city: I.city, pincode: I.pincode });
  if (!g) {
    return res.status(422).json({ error: 'Could not resolve coordinates for this address' + (geocoder.hasKey ? '' : ' (geocoding key not configured)') });
  }
  await db.query(
    `UPDATE installation_requests SET latitude=$1, longitude=$2, geo_source=$3 WHERE id=$4`,
    [g.latitude, g.longitude, g.geo_source, I.id]
  );
  console.log(`[GEOCODE ADMIN] ${I.ref} -> ${g.latitude},${g.longitude} (${g.geo_source}/${g.precision})`);
  res.json({ ok: true, latitude: g.latitude, longitude: g.longitude, geo_source: g.geo_source, precision: g.precision });
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
  voiceWebhook,
  adminListInstallations,
  adminUpdateInstallation,
  translateMessage,
  logCommunication,
  geocodeInstallationRequest,
  assignInstallationTechnician,
  getInstallationTechnicians,
  adminListTickets,
  adminUpdateTicket,
};
