// Admin auth controller.
//
// Endpoints:
//   POST /api/admin/login         { username, password } → sets admin_token cookie
//   POST /api/admin/logout        clears cookie
//   GET  /api/admin/me            returns { username } if logged in, 401 otherwise
//   GET  /api/admin/users         list all admin users (auth required)
//   POST /api/admin/users         { username, password } create user (auth required)
//   POST /api/admin/users/:id/deactivate   flip is_active to false (auth required, can't self-deactivate)
//   POST /api/admin/users/:id/reset-password   { new_password }  (auth required)
//
// Also exports ensureDefaultAdmin() which is called once at backend startup:
// if the admin_users table is empty, it seeds `admin` / `knite-admin`.

const bcrypt = require('bcryptjs');
const db = require('../db');
const { signAdminToken, COOKIE_NAME } = require('../middleware/adminAuth');

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'knite-admin';
const BCRYPT_ROUNDS = 10;
const IS_PROD = process.env.NODE_ENV === 'production';

// ─────────────────────────────────────────────────────────────
// One-time setup on backend boot:
//   1. Ensure the admin_users table exists (idempotent CREATE TABLE).
//   2. Ensure the is_superuser column exists (migration from earlier schema).
//   3. If the table is empty, seed the default admin user as superuser.
//   4. If no superuser exists (migration case), promote the `admin` user.
// ─────────────────────────────────────────────────────────────
async function ensureDefaultAdmin() {
  try {
    // Idempotent DDL — safe to run every boot; matches schema.sql.
    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id            SERIAL PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_by    INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
        is_active     BOOLEAN NOT NULL DEFAULT true,
        is_superuser  BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username)`);
    // Migration: add is_superuser to older deployments that pre-date this column.
    await db.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_superuser BOOLEAN NOT NULL DEFAULT false`);

    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM admin_users`);
    if (rows[0].n === 0) {
      const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, BCRYPT_ROUNDS);
      await db.query(
        `INSERT INTO admin_users (username, password_hash, is_superuser, is_active)
         VALUES ($1, $2, true, true)`,
        [DEFAULT_ADMIN_USERNAME, hash]
      );
      console.log(`[ADMIN_AUTH] seeded default SUPERUSER '${DEFAULT_ADMIN_USERNAME}'`);
      return;
    }

    // Backfill: if there's no superuser yet, promote the default `admin` user.
    const { rows: suRows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM admin_users WHERE is_superuser = true`
    );
    if (suRows[0].n === 0) {
      const r = await db.query(
        `UPDATE admin_users SET is_superuser = true, is_active = true
         WHERE username = $1 RETURNING id`,
        [DEFAULT_ADMIN_USERNAME]
      );
      if (r.rowCount > 0) {
        console.log(`[ADMIN_AUTH] promoted existing '${DEFAULT_ADMIN_USERNAME}' to SUPERUSER`);
      } else {
        // No 'admin' user to promote; promote the lowest-id user as a fallback.
        await db.query(
          `UPDATE admin_users SET is_superuser = true, is_active = true
           WHERE id = (SELECT MIN(id) FROM admin_users)`
        );
        console.log(`[ADMIN_AUTH] promoted lowest-id admin to SUPERUSER (no 'admin' user found)`);
      }
    } else {
      console.log(`[ADMIN_AUTH] superuser exists — skip seed`);
    }
  } catch (err) {
    console.error('[ADMIN_AUTH] seed failed:', err.message);
  }
}

// Helper: fetch full admin row by id (for authZ checks against is_superuser).
async function getAdminById(id) {
  const { rows } = await db.query(
    `SELECT id, username, is_active, is_superuser FROM admin_users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

// Middleware-style guard: only a superuser can proceed. Use inline at the top
// of any handler that manages other admin users.
async function ensureCallerIsSuperuser(req, res) {
  const caller = await getAdminById(req.adminUser.id);
  if (!caller || !caller.is_superuser) {
    res.status(403).json({ error: 'superuser privileges required' });
    return null;
  }
  return caller;
}

// ─────────────────────────────────────────────────────────────
// POST /api/admin/login
// ─────────────────────────────────────────────────────────────
async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  const { rows } = await db.query(
    `SELECT id, username, password_hash, is_active, is_superuser FROM admin_users WHERE username = $1`,
    [username]
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  await db.query(`UPDATE admin_users SET last_login_at = now() WHERE id = $1`, [user.id]);

  const token = signAdminToken(user);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });
  return res.json({
    ok: true,
    user: { id: user.id, username: user.username, is_superuser: user.is_superuser },
  });
}

// ─────────────────────────────────────────────────────────────
// POST /api/admin/logout
// ─────────────────────────────────────────────────────────────
async function logout(req, res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({ ok: true });
}

// ─────────────────────────────────────────────────────────────
// GET /api/admin/me   (public — returns null if not logged in)
// Looks up the DB row so is_superuser and is_active are always fresh (JWT
// doesn't carry those — they can change after token issuance).
// ─────────────────────────────────────────────────────────────
async function me(req, res) {
  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../middleware/adminAuth');
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getAdminById(payload.id);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'user_inactive_or_missing' });
    }
    return res.json({
      user: { id: user.id, username: user.username, is_superuser: user.is_superuser },
    });
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/admin/users   (auth required)
// Everyone who is signed in can see the list, but only the superuser can
// mutate. is_superuser is exposed so the frontend can render accordingly.
// ─────────────────────────────────────────────────────────────
async function listUsers(req, res) {
  const { rows } = await db.query(`
    SELECT u.id, u.username, u.is_active, u.is_superuser,
           u.created_at, u.last_login_at,
           c.username AS created_by_username
    FROM admin_users u
    LEFT JOIN admin_users c ON c.id = u.created_by
    ORDER BY u.is_superuser DESC, u.id ASC
  `);
  return res.json(rows);
}

// ─────────────────────────────────────────────────────────────
// POST /api/admin/users   (superuser only)
// body: { username, password }
// Never allows creating another superuser via the API — the system is
// designed for exactly one root admin.
// ─────────────────────────────────────────────────────────────
async function createUser(req, res) {
  if (!(await ensureCallerIsSuperuser(req, res))) return;

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'username must be ≥3 chars and password ≥6 chars' });
  }
  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const { rows } = await db.query(
      `INSERT INTO admin_users (username, password_hash, created_by, is_superuser)
       VALUES ($1, $2, $3, false)
       RETURNING id, username, is_active, is_superuser, created_at`,
      [username, hash, req.adminUser.id]
    );
    return res.status(201).json({ ok: true, user: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'username already exists' });
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/admin/users/:id/deactivate
// - Superuser only.
// - The superuser can never be deactivated (including by themselves).
// ─────────────────────────────────────────────────────────────
async function deactivateUser(req, res) {
  if (!(await ensureCallerIsSuperuser(req, res))) return;

  const id = parseInt(req.params.id, 10);
  const target = await getAdminById(id);
  if (!target) return res.status(404).json({ error: 'user not found' });
  if (target.is_superuser) {
    return res.status(403).json({ error: 'superuser cannot be deactivated' });
  }
  await db.query(`UPDATE admin_users SET is_active = false WHERE id = $1`, [id]);
  return res.json({ ok: true });
}

// ─────────────────────────────────────────────────────────────
// POST /api/admin/users/:id/reset-password
// body: { new_password }
// - Superuser can reset anyone's password.
// - Non-superusers can only reset their OWN password.
// - The superuser's password can only be reset by the superuser themselves.
// ─────────────────────────────────────────────────────────────
async function resetPassword(req, res) {
  const id = parseInt(req.params.id, 10);
  const { new_password } = req.body || {};
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'new_password must be ≥6 chars' });
  }
  const caller = await getAdminById(req.adminUser.id);
  if (!caller) return res.status(401).json({ error: 'unauthenticated' });

  const target = await getAdminById(id);
  if (!target) return res.status(404).json({ error: 'user not found' });

  const isSelf = caller.id === target.id;
  if (target.is_superuser && !isSelf) {
    return res.status(403).json({ error: 'only the superuser can reset their own password' });
  }
  if (!caller.is_superuser && !isSelf) {
    return res.status(403).json({ error: 'can only reset your own password' });
  }

  const hash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
  await db.query(`UPDATE admin_users SET password_hash = $1 WHERE id = $2`, [hash, id]);
  return res.json({ ok: true });
}

module.exports = {
  ensureDefaultAdmin,
  login,
  logout,
  me,
  listUsers,
  createUser,
  deactivateUser,
  resetPassword,
};
