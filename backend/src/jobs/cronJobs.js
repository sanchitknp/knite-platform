/**
 * CRON Jobs for Knite Platform
 */
const cron = require('node-cron');
const db = require('../db');
const wa = require('../services/whatsappService');
const maintenanceFlow = require('../services/flows/maintenanceFlow');
const { broadcastJob } = require('../services/flows/installationFlow');

/**
 * Every 5 minutes: Broadcast scheduled jobs that start in 30 minutes
 */
function startSlotBroadcastCron() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const result = await db.query(
        `SELECT * FROM jobs
         WHERE status = 'scheduled'
           AND scheduled_start <= now() + INTERVAL '30 minutes'
           AND scheduled_start > now()`
      );

      for (const job of result.rows) {
        console.log(`[CRON] Broadcasting scheduled job ${job.id}`);
        await db.query(
          `UPDATE jobs SET status = 'broadcasting', updated_at = now() WHERE id = $1`,
          [job.id]
        );
        await broadcastJob(job, job.zone_id);
      }
    } catch (err) {
      console.error('[CRON] Slot broadcast error:', err.message);
    }
  });

  console.log('[CRON] Slot broadcast cron started (every 5 min)');
}

/**
 * Every 5 minutes: Expire broadcasts that timed out
 */
function startBroadcastExpiryCron() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const result = await db.query(
        `SELECT * FROM jobs
         WHERE status = 'broadcasting'
           AND broadcast_expires_at < now()`
      );

      for (const job of result.rows) {
        console.log(`[CRON] Broadcast expired for job ${job.id}, escalating to admin`);
        await db.query(
          `UPDATE jobs SET status = 'failed', updated_at = now() WHERE id = $1`,
          [job.id]
        );
        await db.query(
          `UPDATE job_broadcasts SET status = 'expired' WHERE job_id = $1 AND status = 'sent'`,
          [job.id]
        );

        // Notify customer
        const custResult = await db.query(
          `SELECT c.phone FROM customers c JOIN jobs j ON j.customer_id = c.id WHERE j.id = $1`,
          [job.id]
        );
        if (custResult.rows[0]) {
          await wa.sendText(custResult.rows[0].phone,
            `⚠️ We couldn't find a technician for your slot. Our admin has been alerted and will contact you shortly to reschedule.`,
            { line: 'service' }
          );
        }
      }
    } catch (err) {
      console.error('[CRON] Broadcast expiry error:', err.message);
    }
  });

  console.log('[CRON] Broadcast expiry cron started (every 5 min)');
}

/**
 * Every hour: Auto-complete pending_verification jobs after 4 hours
 */
function startAutoCompleteCron() {
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await db.query(
        `SELECT j.*, c.phone as customer_phone, t.phone as tech_phone, u.unit_id as unit_code, u.id as unit_uuid
         FROM jobs j
         JOIN customers c ON c.id = j.customer_id
         JOIN technicians t ON t.id = j.technician_id
         JOIN units u ON u.id = j.unit_id
         WHERE j.status = 'pending_verification'
           AND j.updated_at < now() - INTERVAL '4 hours'`
      );

      for (const job of result.rows) {
        console.log(`[CRON] Auto-completing job ${job.id} (4hr timeout)`);

        await db.query(
          `UPDATE jobs SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = $1`,
          [job.id]
        );

        const newStatus = job.type === 'install' ? 'active' : 'active';
        await db.query(`UPDATE units SET status = $1, updated_at = now() WHERE id = $2`, [newStatus, job.unit_uuid]);

        if (job.type === 'install') {
          const warrantyExpires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
          await db.query(
            `UPDATE units SET install_date = now(), warranty_expires_at = $1 WHERE id = $2`,
            [warrantyExpires, job.unit_uuid]
          );
          const maintenanceService = require('../services/flows/maintenanceFlow');
          await maintenanceService.createInitialSchedule(job.unit_uuid, job.customer_id);
        }

        await db.query(
          `INSERT INTO ledger_entries (job_id, technician_id, type, amount_paise) VALUES ($1, $2, 'tech_payout', $3)`,
          [job.id, job.technician_id, job.payout_paise]
        );

        await wa.sendText(job.customer_phone,
          `✅ Your ${job.type} for *${job.unit_code}* has been auto-completed. The technician has been paid.\n\nIf you have any issues, type *help* anytime.`,
          { line: 'service' }
        );
        await wa.sendText(job.tech_phone,
          `✅ *Job ${job.id} auto-completed.* Payout ₹${Math.round(job.payout_paise / 100)} will be settled this week.`,
          { line: 'tech' }
        );
      }
    } catch (err) {
      console.error('[CRON] Auto-complete error:', err.message);
    }
  });

  console.log('[CRON] Auto-complete cron started (every hour)');
}

/**
 * Daily at 10 AM: Check maintenance schedules
 */
function startMaintenanceCron() {
  cron.schedule('0 10 * * *', async () => {
    console.log('[CRON] Running maintenance check...');
    try {
      await maintenanceFlow.checkAndNotify();
    } catch (err) {
      console.error('[CRON] Maintenance error:', err.message);
    }
  });

  console.log('[CRON] Maintenance cron started (daily 10AM)');
}

/**
 * Initialize all crons
 */
function startAll() {
  startSlotBroadcastCron();
  startBroadcastExpiryCron();
  startAutoCompleteCron();
  startMaintenanceCron();
  console.log('[CRON] All cron jobs initialized');
}

module.exports = { startAll, startSlotBroadcastCron, startBroadcastExpiryCron, startAutoCompleteCron, startMaintenanceCron };
