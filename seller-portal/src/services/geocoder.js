// Location resolution for nearest-technician.
// Order of preference: the installation's own GPS pin → cached pincode centroid →
// Google geocode of the pincode (cached) → Google geocode of the full address.
// Reuses Knite's IP-locked GOOGLE_GEOCODING_KEY (set in the portal .env on the VM).
const db = require('../db');

const KEY = process.env.GOOGLE_GEOCODING_KEY || '';

async function geocode(query) {
  if (!KEY || !query) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=in&key=${KEY}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    if (d.status === 'OK' && d.results && d.results[0]) {
      const l = d.results[0].geometry.location;
      return { lat: l.lat, lng: l.lng };
    }
    if (d.status && d.status !== 'ZERO_RESULTS') console.error('[GEO] status', d.status, d.error_message || '');
  } catch (e) { console.error('[GEO]', e.message); }
  return null;
}

async function pincodeLatLng(pincodeRaw) {
  const pincode = String(pincodeRaw || '').replace(/\D/g, '').slice(0, 6);
  if (pincode.length !== 6) return null;
  const c = await db.query('SELECT lat, lng FROM sp_pincode_geo WHERE pincode = $1', [pincode]);
  if (c.rowCount) return { lat: Number(c.rows[0].lat), lng: Number(c.rows[0].lng), source: 'pincode' };
  const g = await geocode(`${pincode}, India`);
  if (g) {
    await db.query(
      `INSERT INTO sp_pincode_geo (pincode, lat, lng, source) VALUES ($1,$2,$3,'google')
       ON CONFLICT (pincode) DO NOTHING`, [pincode, g.lat, g.lng]
    ).catch(() => {});
    return { ...g, source: 'pincode' };
  }
  return null;
}

// Resolve an installation row to { lat, lng, source } or null.
async function resolveLocation(inst) {
  if (inst.latitude != null && inst.longitude != null) {
    return { lat: Number(inst.latitude), lng: Number(inst.longitude), source: inst.geo_source || 'pin' };
  }
  if (inst.pincode) {
    const p = await pincodeLatLng(inst.pincode);
    if (p) return p;
  }
  if (inst.address) {
    const q = [inst.address, inst.city, inst.pincode].filter(Boolean).join(', ');
    const g = await geocode(q);
    if (g) return { ...g, source: 'geocoded' };
  }
  return null;
}

module.exports = { geocode, pincodeLatLng, resolveLocation, hasKey: !!KEY };
