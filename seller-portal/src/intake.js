// Public intake tokens. Each seller has an unguessable token that appears in its
// customer-facing request URLs (/r/<token>/support, /r/<token>/install). Resolving
// a token yields the seller; the token is the only tenant key the public forms use.
const crypto = require('crypto');
const db = require('./db');

const genToken = () => crypto.randomBytes(18).toString('base64url'); // 24 url-safe chars

async function uniqueToken() {
  for (;;) {
    const t = genToken();
    const c = await db.query('SELECT 1 FROM sp_sellers WHERE public_token = $1', [t]);
    if (!c.rowCount) return t;
  }
}

// Give tokens to any sellers created before this feature existed.
async function backfillTokens() {
  const r = await db.query('SELECT id FROM sp_sellers WHERE public_token IS NULL');
  for (const row of r.rows) {
    await db.query('UPDATE sp_sellers SET public_token = $1 WHERE id = $2', [await uniqueToken(), row.id]);
  }
  if (r.rowCount) console.log(`[INTAKE] backfilled tokens for ${r.rowCount} seller(s)`);
}

async function regenerate(sellerId) {
  const t = await uniqueToken();
  await db.query('UPDATE sp_sellers SET public_token = $1 WHERE id = $2', [t, sellerId]);
  return t;
}

// Resolve a token to an active seller, or null.
async function getByToken(token) {
  if (!token) return null;
  const r = await db.query('SELECT id, business_name, status FROM sp_sellers WHERE public_token = $1', [token]);
  const s = r.rows[0];
  return (s && s.status === 'active') ? s : null;
}

module.exports = { genToken, uniqueToken, backfillTokens, regenerate, getByToken };
