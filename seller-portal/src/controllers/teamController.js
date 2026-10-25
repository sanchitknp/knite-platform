// Team / employee management (RBAC). Routes gated by requirePerm('team.manage').
// Roles are the per-seller roles in sp_roles; the owner account is protected and
// self-lockout is prevented. Everything is scoped to the caller's seller_id.
const db = require('../db');
const { hashPassword } = require('../auth');
const roles = require('../roles');

const email = (v) => String(v || '').trim().toLowerCase();
const clean = (v, n = 200) => (v == null ? null : String(v).trim().slice(0, n) || null);

async function assignableRole(sid, role) {
  const r = String(role || '').trim();
  if (!r || r === 'owner') return null;
  return (await roles.roleExists(sid, r)) ? r : null;
}

// GET /api/team
async function list(req, res) {
  const sid = req.auth.seller_id;
  const r = await db.query(
    `SELECT id, name, email, role, status, last_login_at, created_at
       FROM sp_users WHERE seller_id = $1 ORDER BY (role='owner') DESC, created_at`,
    [sid]
  );
  const all = await roles.listRoles(sid);
  res.json({
    users: r.rows,
    assignable_roles: all.filter(x => x.key !== 'owner').map(x => ({ key: x.key, name: x.name })),
    role_labels: Object.fromEntries(all.map(x => [x.key, x.name])),
  });
}

// POST /api/team  { name, email, role, password }
async function create(req, res) {
  const sid = req.auth.seller_id;
  const name = clean(req.body?.name, 120);
  const mail = email(req.body?.email);
  const password = String(req.body?.password || '');
  if (!mail || !password) return res.status(400).json({ error: 'email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  const role = await assignableRole(sid, req.body?.role);
  if (!role) return res.status(400).json({ error: 'invalid role' });

  const dup = await db.query('SELECT 1 FROM sp_users WHERE email = $1', [mail]);
  if (dup.rowCount) return res.status(409).json({ error: 'A user with this email already exists' });

  const hash = await hashPassword(password);
  const r = await db.query(
    `INSERT INTO sp_users (seller_id, name, email, password_hash, role, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, role, status, created_at`,
    [sid, name, mail, hash, role, req.auth.user_id]
  );
  res.json(r.rows[0]);
}

async function loadTarget(sid, id) {
  const r = await db.query('SELECT id, role, status FROM sp_users WHERE id = $1 AND seller_id = $2', [id, sid]);
  return r.rows[0] || null;
}

// PATCH /api/team/:id  { name?, role?, status? }
async function update(req, res) {
  const sid = req.auth.seller_id;
  const target = await loadTarget(sid, req.params.id);
  if (!target) return res.status(404).json({ error: 'not found' });
  if (target.role === 'owner' && req.auth.role !== 'owner') {
    return res.status(403).json({ error: 'only the owner can modify the owner account' });
  }
  const b = req.body || {};
  const sets = []; const params = [target.id, sid];
  const add = (c, v) => { params.push(v); sets.push(`${c} = $${params.length}`); };

  if (b.name !== undefined) add('name', clean(b.name, 120));

  if (b.role !== undefined) {
    if (target.role === 'owner') return res.status(400).json({ error: "the owner's role cannot be changed here" });
    if (target.id === req.auth.user_id) return res.status(400).json({ error: 'you cannot change your own role' });
    const role = await assignableRole(sid, b.role);
    if (!role) return res.status(400).json({ error: 'invalid role' });
    add('role', role);
  }

  if (b.status !== undefined) {
    const status = String(b.status).trim();
    if (!['active', 'disabled'].includes(status)) return res.status(400).json({ error: 'invalid status' });
    if (target.id === req.auth.user_id) return res.status(400).json({ error: 'you cannot change your own status' });
    if (target.role === 'owner') return res.status(400).json({ error: 'the owner cannot be disabled' });
    add('status', status);
  }

  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  const r = await db.query(
    `UPDATE sp_users SET ${sets.join(', ')} WHERE id = $1 AND seller_id = $2
     RETURNING id, name, email, role, status, last_login_at, created_at`,
    params
  );
  res.json(r.rows[0]);
}

// POST /api/team/:id/reset-password  { password }
async function resetPassword(req, res) {
  const sid = req.auth.seller_id;
  const target = await loadTarget(sid, req.params.id);
  if (!target) return res.status(404).json({ error: 'not found' });
  if (target.role === 'owner' && req.auth.role !== 'owner') {
    return res.status(403).json({ error: 'only the owner can reset the owner password' });
  }
  const password = String(req.body?.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  const hash = await hashPassword(password);
  await db.query('UPDATE sp_users SET password_hash = $1 WHERE id = $2 AND seller_id = $3', [hash, target.id, sid]);
  res.json({ ok: true });
}

module.exports = { list, create, update, resetPassword };
