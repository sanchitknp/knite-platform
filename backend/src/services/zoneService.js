const db = require('../db');

/**
 * Find zone by pincode
 */
async function findZoneByPincode(pincode) {
  const result = await db.query(
    `SELECT * FROM zones WHERE $1 = ANY(pincodes) AND is_active = true LIMIT 1`,
    [pincode]
  );
  return result.rows[0] || null;
}

/**
 * Extract pincode from address string
 */
function extractPincode(text) {
  const match = text.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

/**
 * Get all active technicians in a zone, sorted by home_zone priority + rating
 */
async function getTechniciansInZone(zoneId, pincode = null) {
  const result = await db.query(
    `SELECT t.*, COALESCE(tz.is_home, false) AS is_home
     FROM technicians t
     LEFT JOIN technician_zones tz ON tz.technician_id = t.id AND tz.zone_id = $1
     WHERE ((cardinality(t.coverage_pincodes) = 0 AND tz.zone_id = $1)
         OR $2::text = ANY(t.coverage_pincodes))
       AND t.is_active = true
       AND t.is_verified = true
     ORDER BY is_home DESC, t.rating DESC`,
    [zoneId, pincode]
  );
  return result.rows;
}

/**
 * Get all zones list
 */
async function getAllZones() {
  const result = await db.query(`SELECT * FROM zones WHERE is_active = true ORDER BY name`);
  return result.rows;
}

module.exports = { findZoneByPincode, extractPincode, getTechniciansInZone, getAllZones };
