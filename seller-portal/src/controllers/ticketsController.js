// Module A — Sales & Support. All queries scoped by req.auth.seller_id.
const db = require('../db');

const clean = (v, n = 2000) => (v == null ? null : String(v).trim().slice(0, n) || null);
const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

// GET /api/tickets?status=&q=
async function list(req, res) {
  const sid = req.auth.seller_id;
  const params = [sid];
  let where = 'seller_id = $1';
  if (STATUSES.includes(req.query.status)) { params.push(req.query.status); where += ` AND status = $${params.length}`; }
  if (req.query.q) { params.push(`%${String(req.query.q).trim()}%`); where += ` AND (subject ILIKE $${params.length} OR order_id ILIKE $${params.length} OR customer_name ILIKE $${params.length})`; }
  const r = await db.query(
    `SELECT id, marketplace, order_id, customer_name, customer_contact, channel, category,
            subject, priority, status, source, created_at, updated_at, resolved_at
       FROM sp_support_tickets WHERE ${where}
      ORDER BY (status IN ('resolved','closed')), created_at DESC LIMIT 500`,
    params
  );
  res.json(r.rows);
}

// GET /api/tickets/:id  (with message thread)
async function get(req, res) {
  const sid = req.auth.seller_id;
  const t = await db.query('SELECT * FROM sp_support_tickets WHERE id = $1 AND seller_id = $2', [req.params.id, sid]);
  if (!t.rowCount) return res.status(404).json({ error: 'not found' });
  const m = await db.query(
    'SELECT id, author_type, body, created_at FROM sp_ticket_messages WHERE ticket_id = $1 AND seller_id = $2 ORDER BY created_at',
    [req.params.id, sid]
  );
  res.json({ ...t.rows[0], messages: m.rows });
}

// POST /api/tickets
async function create(req, res) {
  const sid = req.auth.seller_id;
  const b = req.body || {};
  const subject = clean(b.subject, 300);
  if (!subject) return res.status(400).json({ error: 'subject required' });
  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';
  const r = await db.query(
    `INSERT INTO sp_support_tickets
       (seller_id, marketplace, order_id, customer_name, customer_contact, channel, category, subject, description, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [sid, clean(b.marketplace, 20), clean(b.order_id, 80), clean(b.customer_name, 120),
     clean(b.customer_contact, 120), clean(b.channel, 20), clean(b.category, 30), subject,
     clean(b.description), priority]
  );
  res.json(r.rows[0]);
}

// PATCH /api/tickets/:id  { status, priority, category, assigned }
async function update(req, res) {
  const sid = req.auth.seller_id;
  const b = req.body || {};
  const sets = [];
  const params = [req.params.id, sid];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (b.status && STATUSES.includes(b.status)) {
    add('status', b.status);
    sets.push(`resolved_at = ${b.status === 'resolved' || b.status === 'closed' ? 'now()' : 'NULL'}`);
  }
  if (b.priority && PRIORITIES.includes(b.priority)) add('priority', b.priority);
  if (b.category !== undefined) add('category', clean(b.category, 30));
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  sets.push('updated_at = now()');
  const r = await db.query(
    `UPDATE sp_support_tickets SET ${sets.join(', ')} WHERE id = $1 AND seller_id = $2 RETURNING *`,
    params
  );
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  res.json(r.rows[0]);
}

// POST /api/tickets/:id/messages  { body }
async function addMessage(req, res) {
  const sid = req.auth.seller_id;
  const body = clean(req.body?.body, 5000);
  if (!body) return res.status(400).json({ error: 'message body required' });
  const t = await db.query('SELECT 1 FROM sp_support_tickets WHERE id = $1 AND seller_id = $2', [req.params.id, sid]);
  if (!t.rowCount) return res.status(404).json({ error: 'not found' });
  const r = await db.query(
    `INSERT INTO sp_ticket_messages (ticket_id, seller_id, author_type, author_id, body)
     VALUES ($1,$2,'seller',$3,$4) RETURNING id, author_type, body, created_at`,
    [req.params.id, sid, req.auth.user_id, body]
  );
  await db.query('UPDATE sp_support_tickets SET updated_at = now() WHERE id = $1 AND seller_id = $2', [req.params.id, sid]);
  res.json(r.rows[0]);
}

module.exports = { list, get, create, update, addMessage };
