// Public, UNAUTHENTICATED intake endpoints behind a seller's token.
// They only CREATE records (tickets / installation requests) for the token's
// seller — they never read tenant data. Protected by a honeypot field + a simple
// per-IP rate limit, and all inputs are length-capped.
const db = require('../db');
const intake = require('../intake');

const clean = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// In-memory per-IP rate limit: max 15 submissions / 10 min.
const hits = new Map();
function rateLimited(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
  const now = Date.now(), WIN = 10 * 60 * 1000, MAX = 15;
  const arr = (hits.get(ip) || []).filter(t => now - t < WIN);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > MAX;
}

// GET /api/public/:token → minimal branding info (validates the link)
async function info(req, res) {
  const s = await intake.getByToken(req.params.token);
  if (!s) return res.status(404).json({ error: 'This request link is invalid.' });
  res.json({ business_name: s.business_name });
}

// GET /api/public/:token/products → active products for the form dropdown
async function products(req, res) {
  const s = await intake.getByToken(req.params.token);
  if (!s) return res.status(404).json({ error: 'This request link is invalid.' });
  const r = await db.query('SELECT name, sku FROM sp_products WHERE seller_id = $1 AND active ORDER BY name', [s.id]);
  res.json(r.rows);
}

// POST /api/public/:token/support
async function submitSupport(req, res) {
  const s = await intake.getByToken(req.params.token);
  if (!s) return res.status(404).json({ error: 'This request link is invalid.' });
  const b = req.body || {};
  if (b.hp) return res.json({ ok: true });                       // honeypot: silently drop
  if (rateLimited(req)) return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  const customer_name = clean(b.customer_name, 120);
  const subject = clean(b.subject, 300);
  if (!customer_name || !subject) return res.status(400).json({ error: 'Your name and a subject are required.' });
  await db.query(
    `INSERT INTO sp_support_tickets
       (seller_id, marketplace, order_id, customer_name, customer_contact, customer_email, city, pincode,
        channel, category, subject, description, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'public',$9,$10,$11,'public')`,
    [s.id, clean(b.marketplace, 20), clean(b.order_id, 80), customer_name,
     clean(b.customer_contact, 120), clean(b.customer_email, 120), clean(b.city, 80), clean(b.pincode, 10),
     clean(b.category, 30), subject, clean(b.description, 5000)]
  );
  res.json({ ok: true });
}

// POST /api/public/:token/install
async function submitInstall(req, res) {
  const s = await intake.getByToken(req.params.token);
  if (!s) return res.status(404).json({ error: 'This request link is invalid.' });
  const b = req.body || {};
  if (b.hp) return res.json({ ok: true });
  if (rateLimited(req)) return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  const customer_name = clean(b.customer_name, 120);
  const customer_phone = clean(b.customer_phone, 20);
  if (!customer_name || !customer_phone) return res.status(400).json({ error: 'Your name and phone number are required.' });
  const lat = num(b.latitude), lng = num(b.longitude);
  const geo_source = (lat != null && lng != null) ? 'pin' : null;
  await db.query(
    `INSERT INTO sp_installations
       (seller_id, customer_name, customer_phone, customer_email, address, city, pincode,
        product_name, order_id, purchased_from, maps_link, latitude, longitude, geo_source,
        preferred_date, preferred_slot, notes, status, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending','public')`,
    [s.id, customer_name, customer_phone, clean(b.customer_email, 120), clean(b.address, 500),
     clean(b.city, 80), clean(b.pincode, 10), clean(b.product_name, 200), clean(b.order_id, 80),
     clean(b.purchased_from, 30), clean(b.maps_link, 500), lat, lng, geo_source,
     isDate(b.preferred_date) ? b.preferred_date : null, clean(b.preferred_slot, 40), clean(b.notes, 2000)]
  );
  res.json({ ok: true });
}

module.exports = { info, products, submitSupport, submitInstall };
