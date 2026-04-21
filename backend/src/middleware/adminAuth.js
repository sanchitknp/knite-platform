// Admin auth middleware: verify JWT from the `admin_token` httpOnly cookie.
// Routes under /api/admin/* (except /api/admin/login and /api/admin/me) are
// wrapped with this middleware in server.js.

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'knite-dev-secret-change-in-prod';
const COOKIE_NAME = 'admin_token';

function signAdminToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function adminAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.adminUser = { id: payload.id, username: payload.username };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token', message: err.message });
  }
}

module.exports = { adminAuth, signAdminToken, COOKIE_NAME, JWT_SECRET };
