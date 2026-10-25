// Per-seller roles, stored in sp_roles. Permission checks resolve a user's role
// to its permission set from the DB (short-lived cache), so edits in the Roles UI
// take effect almost immediately. The `owner` role is always full and immutable.
const db = require('./db');
const { DEFAULT_ROLES, PERMISSION_KEYS, slugify, sanitizePermissions } = require('./rbac');

// Cache: seller_id -> { at: ms, roles: { key: {name, permissions:Set, is_system} } }
const cache = new Map();
const TTL_MS = 30 * 1000;
const invalidate = (sellerId) => cache.delete(sellerId);

async function loadRoles(sellerId) {
  const hit = cache.get(sellerId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.roles;
  const r = await db.query(
    'SELECT key, name, permissions, is_system FROM sp_roles WHERE seller_id = $1', [sellerId]
  );
  const roles = {};
  for (const row of r.rows) {
    roles[row.key] = { name: row.name, permissions: new Set(row.permissions || []), is_system: row.is_system };
  }
  cache.set(sellerId, { at: Date.now(), roles });
  return roles;
}

// Resolve a role's permissions as an array (owner always = all).
async function permsForUser(sellerId, roleKey) {
  if (roleKey === 'owner') return [...PERMISSION_KEYS];
  const roles = await loadRoles(sellerId);
  return roles[roleKey] ? [...roles[roleKey].permissions] : [];
}

async function hasPerm(sellerId, roleKey, perm) {
  if (roleKey === 'owner') return true;
  const roles = await loadRoles(sellerId);
  return !!(roles[roleKey] && roles[roleKey].permissions.has(perm));
}

// Express middleware factory — gate a route on a single permission.
function requirePerm(perm) {
  return async (req, res, next) => {
    try {
      if (!req.auth?.role) return res.status(401).json({ error: 'unauthenticated' });
      if (await hasPerm(req.auth.seller_id, req.auth.role, perm)) return next();
      return res.status(403).json({ error: 'forbidden', need: perm });
    } catch (e) { next(e); }
  };
}

// Seed the default roles for a seller (idempotent — skips keys already present).
async function seedRolesForSeller(sellerId, client = db) {
  for (const r of DEFAULT_ROLES) {
    await client.query(
      `INSERT INTO sp_roles (seller_id, key, name, permissions, is_system)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (seller_id, key) DO NOTHING`,
      [sellerId, r.key, r.name, r.permissions, r.is_system]
    );
  }
  invalidate(sellerId);
}

// Backfill: seed defaults for any existing seller that has no roles yet.
async function backfillRoles() {
  const r = await db.query(
    `SELECT s.id FROM sp_sellers s
      WHERE NOT EXISTS (SELECT 1 FROM sp_roles r WHERE r.seller_id = s.id)`
  );
  for (const row of r.rows) await seedRolesForSeller(row.id);
  if (r.rowCount) console.log(`[ROLES] seeded defaults for ${r.rowCount} seller(s)`);
}

// ── CRUD (used by rolesController) ────────────────────────────
async function listRoles(sellerId) {
  const r = await db.query(
    `SELECT r.key, r.name, r.permissions, r.is_system,
            (SELECT count(*)::int FROM sp_users u WHERE u.seller_id = r.seller_id AND u.role = r.key) AS user_count
       FROM sp_roles r WHERE r.seller_id = $1
      ORDER BY r.is_system DESC, (r.key='owner') DESC, r.name`,
    [sellerId]
  );
  return r.rows;
}

async function createRole(sellerId, name, permissions) {
  const label = String(name || '').trim().slice(0, 60);
  if (!label) throw httpErr(400, 'role name required');
  let key = slugify(label);
  if (!key) throw httpErr(400, 'invalid role name');
  const exists = await db.query('SELECT 1 FROM sp_roles WHERE seller_id = $1 AND key = $2', [sellerId, key]);
  if (exists.rowCount) key = `${key}_${Date.now().toString(36).slice(-4)}`;
  const perms = sanitizePermissions(permissions);
  const r = await db.query(
    `INSERT INTO sp_roles (seller_id, key, name, permissions, is_system)
     VALUES ($1,$2,$3,$4,false) RETURNING key, name, permissions, is_system`,
    [sellerId, key, label, perms]
  );
  invalidate(sellerId);
  return r.rows[0];
}

async function updateRole(sellerId, key, { name, permissions }) {
  if (key === 'owner') throw httpErr(400, 'the Owner role cannot be modified');
  const cur = await db.query('SELECT key, is_system FROM sp_roles WHERE seller_id = $1 AND key = $2', [sellerId, key]);
  if (!cur.rowCount) throw httpErr(404, 'role not found');
  const sets = []; const params = [sellerId, key];
  if (name !== undefined) { params.push(String(name).trim().slice(0, 60)); sets.push(`name = $${params.length}`); }
  if (permissions !== undefined) { params.push(sanitizePermissions(permissions)); sets.push(`permissions = $${params.length}`); }
  if (!sets.length) throw httpErr(400, 'nothing to update');
  sets.push('updated_at = now()');
  const r = await db.query(
    `UPDATE sp_roles SET ${sets.join(', ')} WHERE seller_id = $1 AND key = $2 RETURNING key, name, permissions, is_system`,
    params
  );
  invalidate(sellerId);
  return r.rows[0];
}

async function deleteRole(sellerId, key) {
  const cur = await db.query('SELECT is_system FROM sp_roles WHERE seller_id = $1 AND key = $2', [sellerId, key]);
  if (!cur.rowCount) throw httpErr(404, 'role not found');
  if (cur.rows[0].is_system) throw httpErr(400, 'built-in roles cannot be deleted');
  const used = await db.query('SELECT count(*)::int AS n FROM sp_users WHERE seller_id = $1 AND role = $2', [sellerId, key]);
  if (used.rows[0].n > 0) throw httpErr(409, `role is assigned to ${used.rows[0].n} user(s); reassign them first`);
  await db.query('DELETE FROM sp_roles WHERE seller_id = $1 AND key = $2', [sellerId, key]);
  invalidate(sellerId);
}

async function roleExists(sellerId, key) {
  const roles = await loadRoles(sellerId);
  return key === 'owner' || !!roles[key];
}

function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = {
  requirePerm, permsForUser, hasPerm, seedRolesForSeller, backfillRoles,
  listRoles, createRole, updateRole, deleteRole, roleExists, invalidate,
};
