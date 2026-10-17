// ============================================================
// Geocoder — turn a typed address into approximate coordinates.
//
// Used when a customer submits an installation request WITHOUT dropping a
// Google Maps pin (the pin is optional on the /support form). The nearest-
// technician ranking only needs an approximate point, so:
//   1) Google Geocoding API on the full address  → street/area accuracy
//   2) Pincode centroid (cache → Google on pincode) → area accuracy (~1-3 km)
// Pincode results are cached in `pincode_geo` so repeat pincodes are free/offline.
//
// All calls are best-effort: any failure returns null, never throws to the caller.
// The API key (GOOGLE_GEOCODING_KEY) is restricted to the Geocoding API + the VM IP.
// ============================================================
const db = require('../db');

const KEY = process.env.GOOGLE_GEOCODING_KEY || '';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

// One raw Google Geocoding lookup. Returns {lat,lng,location_type,partial,formatted} or null.
async function googleGeocode(query, timeoutMs = 6000) {
  if (!KEY || !query) return null;
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(query)}&region=in&components=country:IN&key=${KEY}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const d = await res.json();
    if (d.status === 'REQUEST_DENIED' || d.status === 'OVER_QUERY_LIMIT') {
      console.error('[GEOCODE] Google status', d.status, d.error_message || '');
      return null;
    }
    if (d.status !== 'OK' || !Array.isArray(d.results) || !d.results.length) return null;
    const r = d.results[0];
    const loc = r.geometry && r.geometry.location;
    if (!loc || typeof loc.lat !== 'number') return null;
    return {
      lat: loc.lat,
      lng: loc.lng,
      location_type: (r.geometry && r.geometry.location_type) || null,
      partial: !!r.partial_match,
      formatted: r.formatted_address || null,
    };
  } catch (e) {
    console.error('[GEOCODE] Google request failed:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Area centroid for a 6-digit pincode. Checks the local cache first (offline, free),
// else geocodes the pincode once via Google and caches it. Returns {lat,lng,cached} or null.
async function pincodeCentroid(pincode) {
  const pin = String(pincode || '').replace(/\D/g, '');
  if (pin.length !== 6) return null;
  try {
    const hit = await db.query('SELECT lat, lng FROM pincode_geo WHERE pincode = $1', [pin]);
    if (hit.rowCount) return { lat: Number(hit.rows[0].lat), lng: Number(hit.rows[0].lng), cached: true };
  } catch (e) { /* table may not exist yet — fall through to Google */ }

  const g = await googleGeocode(`${pin}, India`);
  if (!g) return null;
  try {
    await db.query(
      `INSERT INTO pincode_geo (pincode, lat, lng, source)
       VALUES ($1, $2, $3, 'google')
       ON CONFLICT (pincode) DO NOTHING`,
      [pin, g.lat, g.lng]
    );
  } catch (e) { /* cache write is best-effort */ }
  return { lat: g.lat, lng: g.lng, cached: false };
}

/**
 * Resolve approximate coordinates for an installation address.
 * @returns {Promise<{latitude:number, longitude:number, geo_source:'geocoded'|'pincode', precision:string}|null>}
 */
async function geocodeInstallation({ address, city, pincode } = {}) {
  // 1) Full address via Google (most accurate).
  const parts = [address, city, pincode, 'India']
    .map((s) => (s == null ? '' : String(s).trim()))
    .filter(Boolean);
  if (parts.length > 1) {
    const g = await googleGeocode(parts.join(', '));
    if (g) {
      return { latitude: g.lat, longitude: g.lng, geo_source: 'geocoded', precision: g.location_type || 'ADDRESS' };
    }
  }
  // 2) Pincode centroid fallback (cache → Google on pincode).
  const c = await pincodeCentroid(pincode);
  if (c) {
    return { latitude: c.lat, longitude: c.lng, geo_source: 'pincode', precision: 'PINCODE' };
  }
  return null;
}

module.exports = { geocodeInstallation, googleGeocode, pincodeCentroid, hasKey: !!KEY };
