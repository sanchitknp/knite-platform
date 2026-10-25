// Auth helpers for the Seller Service Portal.
// JWT carried in an httpOnly cookie. The token embeds the tenant (seller_id)
// and the user. EVERY data query must scope by req.auth.seller_id — the
// seller_id is taken ONLY from this verified token, never from the request body.
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'ssp-dev-secret-change-in-prod';
const COOKIE_NAME = 'ssp_token';
const BCRYPT_ROUNDS = 10;
// `secure` would stop the cookie from being sent over plain HTTP. We're on
// http://IP:port for now, so default to false; set SSP_COOKIE_SECURE=true once
// the portal is behind HTTPS (a domain + Caddy TLS).
const COOKIE_SECURE = String(process.env.SSP_COOKIE_SECURE || 'false') === 'true';

function signToken(user) {
  return jwt.sign(
    { uid: user.id, sid: user.seller_id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, signToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// The JWT only identifies the user; authorization uses the LIVE DB row, so a
// role change or a disabled account takes effect immediately (not at token expiry).
async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  let p;
  try { p = jwt.verify(token, JWT_SECRET); }
  catch (err) { return res.status(401).json({ error: 'invalid_token', message: err.message }); }
  try {
    const r = await db.query(
      `SELECT u.id, u.seller_id, u.role, u.status, u.email, s.status AS seller_status
         FROM sp_users u JOIN sp_sellers s ON s.id = u.seller_id WHERE u.id = $1`,
      [p.uid]
    );
    const u = r.rows[0];
    if (!u || u.status !== 'active' || u.seller_status !== 'active') {
      return res.status(401).json({ error: 'unauthenticated' });
    }
    req.auth = { user_id: u.id, seller_id: u.seller_id, role: u.role, email: u.email };
    next();
  } catch (err) { next(err); }
}

const hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_ROUNDS);
const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);

module.exports = {
  JWT_SECRET, COOKIE_NAME,
  signToken, setAuthCookie, clearAuthCookie, requireAuth,
  hashPassword, checkPassword,
};
