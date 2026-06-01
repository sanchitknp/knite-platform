/**
 * Knite Shop — customer authentication (phone + WhatsApp OTP).
 * No passwords. Cookie-based sessions, 90-day expiry.
 */
const crypto = require('crypto');
const db = require('../db');
const wa = require('../services/whatsappService');

const OTP_EXPIRY_MIN = 10;
const SESSION_DAYS   = 90;
const COOKIE_NAME    = 'kn_shop';
const COOKIE_OPTS    = {
  httpOnly: true,
  secure: process.env.NODE_ENV !== 'development',
  sameSite: 'lax',
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  path: '/',
};

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0'))  return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

function generateOtp() {
  // 6-digit numeric OTP, no leading zeros tricky-edge — pad to 6
  return String(crypto.randomInt(100000, 1000000));
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─────────────────────────────────────────────────────────────
// POST /api/shop/auth/send-otp  { phone }
// ─────────────────────────────────────────────────────────────
async function sendOtp(req, res) {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Valid 10-digit phone required' });

    // Rate limit: max 3 OTP requests per phone per 10 min
    const recent = await db.query(
      `SELECT COUNT(*)::int AS c FROM shop_otps
       WHERE phone = $1 AND created_at > NOW() - INTERVAL '10 minutes'`,
      [phone]
    );
    if (recent.rows[0].c >= 3) {
      return res.status(429).json({ error: 'Too many OTP requests. Try again in 10 minutes.' });
    }

    const otp = generateOtp();
    await db.query(
      `INSERT INTO shop_otps (phone, otp_code, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '${OTP_EXPIRY_MIN} minutes')`,
      [phone, otp]
    );

    const msg =
      `🔐 *Knite Login Code*\n\n` +
      `Your verification code is:\n*${otp}*\n\n` +
      `Valid for ${OTP_EXPIRY_MIN} minutes. Do not share this with anyone.\n\n` +
      `If you didn't request this, ignore this message.`;
    // Send via the TECH line (real Indian business number +91 91960 68335)
    // so users recognise the sender. The SERVICE line is the US test number.
    await wa.sendText('91' + phone, msg, { line: 'tech' })
      .catch(e => console.error('[SHOP-AUTH] WA send failed:', e.message));

    console.log(`[SHOP-AUTH] OTP sent to ${phone} (dev=${process.env.NODE_ENV === 'development' ? otp : '***'})`);
    res.json({ ok: true, message: 'OTP sent to your WhatsApp', expires_in: OTP_EXPIRY_MIN * 60 });
  } catch (err) {
    console.error('[SHOP-AUTH] sendOtp:', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/shop/auth/verify-otp  { phone, otp, name?, email? }
// On success: creates session cookie, auto-creates customer if new.
// ─────────────────────────────────────────────────────────────
async function verifyOtp(req, res) {
  const client = await db.pool.connect();
  try {
    const phone = normalizePhone(req.body.phone);
    const otpInput = String(req.body.otp || '').trim();
    if (!phone || !otpInput) return res.status(400).json({ error: 'phone and otp required' });

    // Look up most recent unused OTP for phone
    const r = await client.query(
      `SELECT * FROM shop_otps
       WHERE phone = $1 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [phone]
    );
    if (!r.rows.length) return res.status(400).json({ error: 'OTP expired. Request a new one.' });
    const row = r.rows[0];

    if (row.attempts >= 5) {
      await client.query(`UPDATE shop_otps SET used = TRUE WHERE id = $1`, [row.id]);
      return res.status(429).json({ error: 'Too many attempts. Request a new OTP.' });
    }

    if (row.otp_code !== otpInput) {
      await client.query(`UPDATE shop_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      return res.status(400).json({ error: 'Invalid OTP. Please try again.' });
    }

    // Mark OTP used
    await client.query(`UPDATE shop_otps SET used = TRUE WHERE id = $1`, [row.id]);

    // Find or create customer
    await client.query('BEGIN');
    let customer;
    const ex = await client.query(`SELECT * FROM shop_customers WHERE phone = $1`, [phone]);
    if (ex.rows.length) {
      customer = ex.rows[0];
      // Optionally update name/email if blank and provided this time
      const updates = [];
      const vals = [];
      if (!customer.name && req.body.name)  { updates.push(`name = $${updates.length + 1}`);  vals.push(String(req.body.name).trim()); }
      if (!customer.email && req.body.email) { updates.push(`email = $${updates.length + 1}`); vals.push(String(req.body.email).trim().toLowerCase()); }
      updates.push(`phone_verified = TRUE`, `last_login_at = NOW()`);
      vals.push(customer.id);
      await client.query(
        `UPDATE shop_customers SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`,
        vals
      );
    } else {
      const ins = await client.query(
        `INSERT INTO shop_customers (phone, name, email, phone_verified, last_login_at)
         VALUES ($1, $2, $3, TRUE, NOW())
         RETURNING *`,
        [phone, req.body.name?.trim() || null, req.body.email?.trim().toLowerCase() || null]
      );
      customer = ins.rows[0];

      // Backfill: link any prior guest orders with this phone to this new customer
      await client.query(
        `UPDATE shop_orders SET customer_id = $1 WHERE customer_phone = $2 AND customer_id IS NULL`,
        [customer.id, phone]
      );
    }

    // Create session token + cookie
    const token = generateToken();
    await client.query(
      `INSERT INTO shop_sessions (token, customer_id, expires_at, user_agent, ip_address)
       VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days', $3, $4)`,
      [token, customer.id, req.headers['user-agent'] || null, (req.ip || '').slice(0, 45)]
    );
    await client.query('COMMIT');

    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    res.json({
      ok: true,
      customer: {
        id: customer.id,
        phone: customer.phone,
        name: customer.name,
        email: customer.email,
      },
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[SHOP-AUTH] verifyOtp:', err);
    res.status(500).json({ error: 'Verification failed' });
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/shop/auth/logout
// ─────────────────────────────────────────────────────────────
async function logout(req, res) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) await db.query(`DELETE FROM shop_sessions WHERE token = $1`, [token]);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[SHOP-AUTH] logout:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
}

// ─────────────────────────────────────────────────────────────
// Middleware — attach req.shopCustomer if session valid.
// Use `requireShopCustomer` to gate protected endpoints.
// ─────────────────────────────────────────────────────────────
async function attachShopCustomer(req, _res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return next();
    const r = await db.query(
      `SELECT c.* FROM shop_sessions s
       JOIN shop_customers c ON c.id = s.customer_id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );
    if (r.rows.length) req.shopCustomer = r.rows[0];
  } catch (err) {
    console.error('[SHOP-AUTH] attachShopCustomer:', err.message);
  }
  next();
}

function requireShopCustomer(req, res, next) {
  if (!req.shopCustomer) return res.status(401).json({ error: 'Login required' });
  next();
}

// ─────────────────────────────────────────────────────────────
// GET /api/shop/me   — current logged-in customer
// ─────────────────────────────────────────────────────────────
async function me(req, res) {
  if (!req.shopCustomer) return res.json({ logged_in: false });
  const c = req.shopCustomer;
  res.json({
    logged_in: true,
    customer: {
      id: c.id,
      phone: c.phone,
      name: c.name,
      email: c.email,
      total_orders: c.total_orders,
      total_spent: c.total_spent,
      created_at: c.created_at,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// PATCH /api/shop/me   — update profile
// ─────────────────────────────────────────────────────────────
async function updateMe(req, res) {
  try {
    const c = req.shopCustomer;
    const allowed = ['name', 'email', 'marketing_optin'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        sets.push(`${k} = $${sets.length + 1}`);
        vals.push(req.body[k]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(c.id);
    await db.query(
      `UPDATE shop_customers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`,
      vals
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[SHOP-AUTH] updateMe:', err);
    res.status(500).json({ error: 'Update failed' });
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/shop/my-orders   — order history for logged-in customer
// ─────────────────────────────────────────────────────────────
async function myOrders(req, res) {
  try {
    const r = await db.query(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.payment_method,
              o.total_amount, o.created_at, o.shipped_at, o.delivered_at,
              o.tracking_number, o.shipping_carrier,
              (SELECT json_agg(json_build_object(
                 'name', product_name, 'qty', quantity, 'line_total', line_total
               )) FROM shop_order_items WHERE order_id = o.id) AS items
       FROM shop_orders o
       WHERE o.customer_id = $1 OR (o.customer_phone = $2 AND o.customer_id IS NULL)
       ORDER BY o.created_at DESC
       LIMIT 100`,
      [req.shopCustomer.id, req.shopCustomer.phone]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[SHOP-AUTH] myOrders:', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
}

// ─────────────────────────────────────────────────────────────
// GET / POST / DELETE  /api/shop/my-addresses
// ─────────────────────────────────────────────────────────────
async function listAddresses(req, res) {
  const r = await db.query(
    `SELECT * FROM shop_customer_addresses WHERE customer_id = $1 ORDER BY is_default DESC, id DESC`,
    [req.shopCustomer.id]
  );
  res.json(r.rows);
}

async function addAddress(req, res) {
  try {
    const a = req.body;
    if (!a.line1 || !a.city || !a.state || !a.pincode) {
      return res.status(400).json({ error: 'line1, city, state, pincode required' });
    }
    if (a.is_default) {
      await db.query(`UPDATE shop_customer_addresses SET is_default = FALSE WHERE customer_id = $1`, [req.shopCustomer.id]);
    }
    const r = await db.query(
      `INSERT INTO shop_customer_addresses
        (customer_id, label, full_name, phone, line1, line2, city, state, pincode, country, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        req.shopCustomer.id,
        a.label || 'Home',
        a.full_name || req.shopCustomer.name || '',
        a.phone   || req.shopCustomer.phone,
        a.line1, a.line2 || '', a.city, a.state, a.pincode, a.country || 'IN',
        !!a.is_default,
      ]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[SHOP-AUTH] addAddress:', err);
    res.status(500).json({ error: 'Failed to save address' });
  }
}

async function deleteAddress(req, res) {
  await db.query(
    `DELETE FROM shop_customer_addresses WHERE id = $1 AND customer_id = $2`,
    [req.params.id, req.shopCustomer.id]
  );
  res.json({ ok: true });
}

module.exports = {
  sendOtp,
  verifyOtp,
  logout,
  me,
  updateMe,
  myOrders,
  listAddresses,
  addAddress,
  deleteAddress,
  attachShopCustomer,
  requireShopCustomer,
  COOKIE_NAME,
};
