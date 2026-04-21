/**
 * Admin REST API Controller
 */
const db = require('../db');
const wa = require('../services/whatsappService');
const { broadcastJob } = require('../services/flows/installationFlow');

// ── Dashboard Stats ──
async function getStats(req, res) {
  const [units, jobs, techs, pending] = await Promise.all([
    db.query(`SELECT status, COUNT(*) as cnt FROM units GROUP BY status`),
    db.query(`SELECT status, COUNT(*) as cnt FROM jobs GROUP BY status`),
    db.query(`SELECT is_active, is_verified, COUNT(*) as cnt FROM technicians GROUP BY is_active, is_verified`),
    db.query(`SELECT COUNT(*) as cnt FROM maintenance_schedules WHERE status IN ('pending','reminded')`),
  ]);

  res.json({
    units: units.rows,
    jobs: jobs.rows,
    technicians: techs.rows,
    pending_maintenance: pending.rows[0]?.cnt || 0,
  });
}

// ── Units ──
async function getUnits(req, res) {
  const result = await db.query(
    `SELECT u.*, c.phone as customer_phone, c.name as customer_name, z.name as zone_name
     FROM units u
     LEFT JOIN customers c ON c.id = u.customer_id
     LEFT JOIN zones z ON z.id = u.zone_id
     ORDER BY u.created_at DESC`
  );
  res.json(result.rows);
}

async function getUnit(req, res) {
  const result = await db.query(
    `SELECT u.*, c.phone as customer_phone, z.name as zone_name
     FROM units u LEFT JOIN customers c ON c.id = u.customer_id LEFT JOIN zones z ON z.id = u.zone_id
     WHERE u.id = $1 OR u.unit_id = $1`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Unit not found' });

  const events = await db.query(
    `SELECT * FROM unit_events WHERE unit_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [result.rows[0].id]
  );
  res.json({ ...result.rows[0], events: events.rows });
}

async function seedUnit(req, res) {
  const { unit_id, model } = req.body;
  if (!unit_id) return res.status(400).json({ error: 'unit_id required' });

  const result = await db.query(
    `INSERT INTO units (unit_id, status, model) VALUES ($1, 'shipped', $2) RETURNING *`,
    [unit_id, model || 'Knite RO Standard']
  );
  res.json(result.rows[0]);
}

// ── Jobs ──
async function getJobs(req, res) {
  const result = await db.query(
    `SELECT j.*, u.unit_id as unit_code, c.phone as customer_phone,
            t.name as tech_name, t.phone as tech_phone, z.name as zone_name
     FROM jobs j
     LEFT JOIN units u ON u.id = j.unit_id
     LEFT JOIN customers c ON c.id = j.customer_id
     LEFT JOIN technicians t ON t.id = j.technician_id
     LEFT JOIN zones z ON z.id = j.zone_id
     ORDER BY j.created_at DESC
     LIMIT 100`
  );
  res.json(result.rows);
}

async function getJob(req, res) {
  const job = await db.query(
    `SELECT j.*, u.unit_id as unit_code, c.phone as customer_phone,
            t.name as tech_name, t.phone as tech_phone
     FROM jobs j
     LEFT JOIN units u ON u.id = j.unit_id
     LEFT JOIN customers c ON c.id = j.customer_id
     LEFT JOIN technicians t ON t.id = j.technician_id
     WHERE j.id = $1`,
    [req.params.id]
  );
  if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });

  const events = await db.query(
    `SELECT * FROM job_events WHERE job_id = $1 ORDER BY created_at DESC`,
    [job.rows[0].id]
  );
  const broadcasts = await db.query(
    `SELECT jb.*, t.name, t.phone FROM job_broadcasts jb JOIN technicians t ON t.id = jb.technician_id WHERE jb.job_id = $1`,
    [job.rows[0].id]
  );

  res.json({ ...job.rows[0], events: events.rows, broadcasts: broadcasts.rows });
}

async function forceBroadcast(req, res) {
  const jobResult = await db.query(`SELECT * FROM jobs WHERE id = $1`, [req.params.id]);
  if (!jobResult.rows[0]) return res.status(404).json({ error: 'Job not found' });

  const job = jobResult.rows[0];
  await db.query(`UPDATE jobs SET status = 'broadcasting', updated_at = now() WHERE id = $1`, [job.id]);
  await broadcastJob(job, job.zone_id);

  res.json({ message: 'Broadcast sent', job_id: job.id });
}

async function resolveDispute(req, res) {
  const { decision } = req.body;
  const jobResult = await db.query(`SELECT * FROM jobs WHERE id = $1`, [req.params.id]);
  const job = jobResult.rows[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (decision === 'pay_tech') {
    await db.query(`UPDATE jobs SET status = 'completed', completed_at = now() WHERE id = $1`, [job.id]);
    await db.query(
      `INSERT INTO ledger_entries (job_id, technician_id, type, amount_paise) VALUES ($1, $2, 'tech_payout', $3)`,
      [job.id, job.technician_id, job.payout_paise]
    );
    const techResult = await db.query(`SELECT * FROM technicians WHERE id = $1`, [job.technician_id]);
    if (techResult.rows[0]) {
      await wa.sendText(techResult.rows[0].phone, `✅ Admin resolved dispute in your favor. Payout released!`, { line: 'tech' });
    }
  } else {
    await db.query(`UPDATE jobs SET status = 'failed', updated_at = now() WHERE id = $1`, [job.id]);
    const custResult = await db.query(`SELECT * FROM customers WHERE id = $1`, [job.customer_id]);
    if (custResult.rows[0]) {
      await wa.sendText(custResult.rows[0].phone, `✅ Dispute resolved in your favor. We'll re-dispatch a technician.`, { line: 'service' });
    }
  }

  res.json({ message: 'Dispute resolved', decision });
}

// ── Technicians ──
async function getTechnicians(req, res) {
  const result = await db.query(
    `SELECT t.*, z.name as home_zone_name,
            ARRAY_AGG(z2.name) FILTER (WHERE z2.id IS NOT NULL) as all_zones
     FROM technicians t
     LEFT JOIN zones z ON z.id = t.home_zone_id
     LEFT JOIN technician_zones tz ON tz.technician_id = t.id
     LEFT JOIN zones z2 ON z2.id = tz.zone_id
     GROUP BY t.id, z.name
     ORDER BY t.created_at DESC`
  );
  res.json(result.rows);
}

async function approveTechnician(req, res) {
  const { approved } = req.body;
  const result = await db.query(
    `UPDATE technicians SET is_verified = $1, is_active = $1, updated_at = now()
     WHERE id = $2 RETURNING *`,
    [approved, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Technician not found' });

  const tech = result.rows[0];
  if (approved) {
    await wa.sendText(tech.phone,
      `🎉 *Congratulations ${tech.name}!*\n\nYour Knite technician account is now *ACTIVE*!\n\nYou'll start receiving job notifications in your zone. Welcome to the team! 🔧`,
      { line: 'tech' }
    );
  } else {
    await wa.sendText(tech.phone, `❌ Your application was not approved. Please type *REGISTER TECH* to resubmit with a clearer Aadhaar photo.`, { line: 'tech' });
  }

  res.json(result.rows[0]);
}

// ── Zones ──
async function getZones(req, res) {
  const result = await db.query(`SELECT * FROM zones WHERE is_active = true ORDER BY name`);
  res.json(result.rows);
}

// ── Messages (for admin) ──
async function getRecentMessages(req, res) {
  const messages = await wa.getAllRecentMessages(100);
  res.json(messages);
}

// ── Maintenance Schedules ──
async function getMaintenanceSchedules(req, res) {
  const result = await db.query(
    `SELECT ms.*, u.unit_id as unit_code, c.phone as customer_phone
     FROM maintenance_schedules ms
     JOIN units u ON u.id = ms.unit_id
     JOIN customers c ON c.id = ms.customer_id
     ORDER BY ms.due_at ASC`
  );
  res.json(result.rows);
}

// ── Ledger ──
async function getLedger(req, res) {
  const result = await db.query(
    `SELECT le.*, j.type as job_type, t.name as tech_name
     FROM ledger_entries le
     JOIN jobs j ON j.id = le.job_id
     LEFT JOIN technicians t ON t.id = le.technician_id
     ORDER BY le.created_at DESC LIMIT 100`
  );

  const summary = await db.query(
    `SELECT t.name, t.phone, SUM(le.amount_paise) as total_paise, COUNT(*) as entries
     FROM ledger_entries le JOIN technicians t ON t.id = le.technician_id
     WHERE le.type = 'tech_payout' AND le.settled = false
     GROUP BY t.id, t.name, t.phone`
  );

  res.json({ entries: result.rows, unsettled_summary: summary.rows });
}

async function markSettled(req, res) {
  await db.query(
    `UPDATE ledger_entries SET settled = true, settled_at = now() WHERE technician_id = $1 AND settled = false`,
    [req.params.techId]
  );
  res.json({ message: 'Marked as settled' });
}

// ── Customers ──
async function getCustomers(req, res) {
  const result = await db.query(
    `SELECT c.*, COUNT(u.id) as unit_count
     FROM customers c LEFT JOIN units u ON u.customer_id = c.id
     GROUP BY c.id ORDER BY c.created_at DESC`
  );
  res.json(result.rows);
}

module.exports = {
  getStats, getUnits, getUnit, seedUnit,
  getJobs, getJob, forceBroadcast, resolveDispute,
  getTechnicians, approveTechnician,
  getZones, getRecentMessages,
  getMaintenanceSchedules, getLedger, markSettled,
  getCustomers,
};
