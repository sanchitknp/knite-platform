// Dashboard summary — all counts scoped to the authenticated seller.
const db = require('../db');

// GET /api/dashboard
async function summary(req, res) {
  const sid = req.auth.seller_id;
  const [tickets, listings, claims, installs] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed'))::int AS open
       FROM sp_support_tickets WHERE seller_id = $1`, [sid]),
    db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE status = 'suppressed')::int AS suppressed
       FROM sp_listings WHERE seller_id = $1`, [sid]),
    db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'filed')::int AS filed
       FROM sp_safety_claims WHERE seller_id = $1`, [sid]),
    db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'installed')::int AS installed
       FROM sp_installations WHERE seller_id = $1`, [sid]),
  ]);
  res.json({
    tickets: tickets.rows[0],
    listings: listings.rows[0],
    safety_claims: claims.rows[0],
    installations: installs.rows[0],
  });
}

module.exports = { summary };
