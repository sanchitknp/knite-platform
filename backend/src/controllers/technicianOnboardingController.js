const db = require('../db');

const PINCODE = /^[1-9]\d{5}$/;
const MAP_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'maps.google.com',
  'maps.google.co.in', 'www.google.com', 'google.com', 'www.google.co.in', 'google.co.in']);

function validateApplication(body) {
  const errors = {};
  const data = {};
  for (const [key, min, max] of [['name', 2, 120], ['address', 10, 500], ['city', 2, 100], ['state', 2, 100]]) {
    const value = typeof body?.[key] === 'string' ? body[key].trim() : '';
    if (value.length < min || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
      errors[key] = `Enter ${min}–${max} characters.`;
    }
    data[key] = value;
  }
  const rawPhone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  let phone = rawPhone.replace(/[\s()+-]/g, '');
  if (/^[6-9]\d{9}$/.test(phone)) phone = '91' + phone;
  if (!/^91[6-9]\d{9}$/.test(phone)) errors.phone = 'Enter a valid Indian mobile number (10 digits, optionally +91).';
  data.phone = phone;

  const maps = typeof body?.google_maps_link === 'string' ? body.google_maps_link.trim() : '';
  try {
    const url = new URL(maps);
    const host = url.hostname.toLowerCase();
    const validPath = host === 'maps.app.goo.gl' ? url.pathname.length > 1
      : host === 'goo.gl' ? url.pathname.startsWith('/maps/')
      : host.startsWith('maps.google.') ? true : /^\/maps(?:\/|$)/.test(url.pathname);
    if (maps.length > 2048 || url.protocol !== 'https:' || !MAP_HOSTS.has(host) || !validPath || url.username || url.password || url.port) throw new Error('Invalid maps link');
    data.google_maps_link = url.href;
  } catch {
    errors.google_maps_link = 'Paste a Google Maps HTTPS location or share link.';
  }

  let pincodes = body?.coverage_pincodes;
  if (typeof pincodes === 'string' && pincodes.length <= 4000) pincodes = pincodes.split(/[,\s]+/).filter(Boolean);
  if (!Array.isArray(pincodes) || pincodes.length < 1 || pincodes.length > 100 ||
      pincodes.some(p => typeof p !== 'string' || !PINCODE.test(p.trim()))) {
    errors.coverage_pincodes = 'Enter 1–100 valid six-digit pincodes, separated by commas or spaces.';
  } else {
    data.coverage_pincodes = [...new Set(pincodes.map(p => p.trim()))].sort();
  }
  if (body?.consent !== true) errors.consent = 'Please allow Knite to contact you about technician onboarding and service work.';
  return { data, errors };
}

// Per-process limit: no forwarded headers are trusted, so a shared reverse proxy
// shares this allowance. Bounded state; no personally identifying values logged.
function createSubmissionLimiter({ max = 60, windowMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const attempts = new Map();
  return (req, res, next) => {
    const time = now();
    for (const [key, entry] of attempts) if (entry.until <= time) attempts.delete(key);
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    let entry = attempts.get(key);
    if (!entry) {
      if (attempts.size >= 5000) return res.status(429).json({ error: 'Please try again later.' });
      entry = { count: 0, until: time + windowMs };
      attempts.set(key, entry);
    }
    if (++entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.until - time) / 1000)));
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    next();
  };
}

async function registerTechnician(req, res) {
  const { data: d, errors } = validateApplication(req.body);
  res.set('Cache-Control', 'no-store');
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please check the highlighted details.', fields: errors });
  try {
    const result = await db.query(
      `INSERT INTO technicians (name, phone, address, city, state, google_maps_link,
          coverage_pincodes, registration_source, is_active, is_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'public_form',false,false)
       ON CONFLICT (phone) DO NOTHING RETURNING id`,
      [d.name, d.phone, d.address, d.city, d.state, d.google_maps_link, d.coverage_pincodes]
    );
    // A public submission must never overwrite an existing technician's profile
    // or verification status. Do not expose any existing profile information.
    if (!result.rowCount) return res.status(409).json({ error: 'This mobile number is already registered. Contact Knite to update your details.' });
    return res.status(201).json({ ok: true, status: 'pending_review', message: 'Registration received. The Knite team will contact you to review your application.' });
  } catch (err) {
    console.error('[TECH ONBOARDING] Registration failed:', err.code || 'database_error');
    return res.status(503).json({ error: 'Registration is temporarily unavailable. Please try again later.' });
  }
}

module.exports = { registerTechnician, validateApplication, createSubmissionLimiter };
