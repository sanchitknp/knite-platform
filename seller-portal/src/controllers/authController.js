// Seller signup / login / session. Signup creates the tenant (sp_sellers) plus
// its first user (sp_users, role=owner) atomically.
const db = require('../db');
const { setAuthCookie, clearAuthCookie, hashPassword, checkPassword } = require('../auth');
const roles = require('../roles');
const intake = require('../intake');

const email = (v) => String(v || '').trim().toLowerCase();
const clean = (v, n = 200) => String(v || '').trim().slice(0, n);

// POST /api/auth/signup { business_name, contact_name, email, phone, password }
async function signup(req, res) {
  const business_name = clean(req.body?.business_name);
  const contact_name = clean(req.body?.contact_name);
  const mail = email(req.body?.email);
  const phone = clean(req.body?.phone, 20);
  const password = String(req.body?.password || '');
  if (!business_name || !mail || !password) {
    return res.status(400).json({ error: 'business_name, email and password are required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });

  const dup = await db.query('SELECT 1 FROM sp_users WHERE email = $1', [mail]);
  if (dup.rowCount) return res.status(409).json({ error: 'An account with this email already exists' });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const s = await client.query(
      `INSERT INTO sp_sellers (business_name, contact_name, email, phone, public_token)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [business_name, contact_name || null, mail, phone || null, intake.genToken()]
    );
    const seller_id = s.rows[0].id;
    await roles.seedRolesForSeller(seller_id, client);   // default roles for this tenant
    const hash = await hashPassword(password);
    const u = await client.query(
      `INSERT INTO sp_users (seller_id, name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,'owner') RETURNING id, seller_id, email, role`,
      [seller_id, contact_name || null, mail, hash]
    );
    await client.query('COMMIT');
    setAuthCookie(res, u.rows[0]);
    res.json({ ok: true, user: { email: mail, role: 'owner' }, business_name });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[signup]', e.message);
    res.status(500).json({ error: 'signup failed' });
  } finally {
    client.release();
  }
}

// POST /api/auth/login { email, password }
async function login(req, res) {
  const mail = email(req.body?.email);
  const password = String(req.body?.password || '');
  if (!mail || !password) return res.status(400).json({ error: 'email and password required' });

  const r = await db.query(
    `SELECT u.id, u.seller_id, u.email, u.role, u.password_hash, u.status, s.business_name, s.status AS seller_status
       FROM sp_users u JOIN sp_sellers s ON s.id = u.seller_id
      WHERE u.email = $1`,
    [mail]
  );
  const user = r.rows[0];
  if (!user) return res.status(401).json({ error: 'invalid email or password' });
  if (user.status !== 'active' || user.seller_status !== 'active') {
    return res.status(403).json({ error: 'account suspended' });
  }
  const ok = await checkPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid email or password' });

  await db.query('UPDATE sp_users SET last_login_at = now() WHERE id = $1', [user.id]);
  setAuthCookie(res, user);
  res.json({ ok: true, user: { email: user.email, role: user.role }, business_name: user.business_name });
}

// POST /api/auth/logout
async function logout(req, res) {
  clearAuthCookie(res);
  res.json({ ok: true });
}

// GET /api/auth/me
async function me(req, res) {
  const r = await db.query(
    `SELECT u.id, u.name, u.email, u.role, s.id AS seller_id, s.business_name, s.plan
       FROM sp_users u JOIN sp_sellers s ON s.id = u.seller_id
      WHERE u.id = $1 AND u.seller_id = $2`,
    [req.auth.user_id, req.auth.seller_id]
  );
  if (!r.rowCount) return res.status(401).json({ error: 'unauthenticated' });
  const permissions = await roles.permsForUser(req.auth.seller_id, r.rows[0].role);
  res.json({ ...r.rows[0], permissions });
}

// GET /api/marketplaces
async function listMarketplaces(req, res) {
  const r = await db.query(
    `SELECT id, marketplace, external_seller_id, display_name, status, created_at
       FROM sp_seller_marketplaces WHERE seller_id = $1 ORDER BY created_at`,
    [req.auth.seller_id]
  );
  res.json(r.rows);
}

// POST /api/marketplaces { marketplace, external_seller_id, display_name }
async function addMarketplace(req, res) {
  const marketplace = clean(req.body?.marketplace, 20).toLowerCase();
  if (!['amazon', 'flipkart'].includes(marketplace)) {
    return res.status(400).json({ error: 'marketplace must be amazon or flipkart' });
  }
  const external_seller_id = clean(req.body?.external_seller_id, 120) || null;
  const display_name = clean(req.body?.display_name, 120) || null;
  const r = await db.query(
    `INSERT INTO sp_seller_marketplaces (seller_id, marketplace, external_seller_id, display_name)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (seller_id, marketplace, external_seller_id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id, marketplace, external_seller_id, display_name, status, created_at`,
    [req.auth.seller_id, marketplace, external_seller_id, display_name]
  );
  res.json(r.rows[0]);
}

// GET /api/intake-links → the seller's public request token (links built client-side)
async function intakeLinks(req, res) {
  const r = await db.query('SELECT public_token FROM sp_sellers WHERE id = $1', [req.auth.seller_id]);
  res.json({ token: r.rows[0]?.public_token || null });
}

// POST /api/intake-links/regenerate → new token (invalidates the old links)
async function regenerateIntakeToken(req, res) {
  const token = await intake.regenerate(req.auth.seller_id);
  res.json({ token });
}

module.exports = {
  signup, login, logout, me, listMarketplaces, addMarketplace,
  intakeLinks, regenerateIntakeToken,
};
