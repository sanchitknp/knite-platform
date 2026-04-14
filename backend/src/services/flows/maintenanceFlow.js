/**
 * Flow 3: Recurring Maintenance
 * Triggered by: CRON daily at 10 AM
 */
const db = require('../../db');
const wa = require('../whatsappService');
const session = require('../sessionService');
const otp = require('../otpService');
const { broadcastJob } = require('./installationFlow');

/**
 * CRON: Check for due maintenance schedules and send reminders
 */
async function checkAndNotify() {
  const result = await db.query(
    `SELECT ms.*, u.unit_id as unit_code, u.zone_id, c.phone as customer_phone, c.name as customer_name
     FROM maintenance_schedules ms
     JOIN units u ON u.id = ms.unit_id
     JOIN customers c ON c.id = ms.customer_id
     WHERE ms.status IN ('pending', 'snoozed')
       AND ms.due_at <= now()
       AND (ms.snoozed_until IS NULL OR ms.snoozed_until <= now())
       AND ms.reminder_count < 3
       AND u.status = 'active'`
  );

  for (const schedule of result.rows) {
    await sendMaintenanceReminder(schedule);
  }

  console.log(`[CRON] Maintenance check: ${result.rows.length} schedules processed`);
}

async function sendMaintenanceReminder(schedule) {
  const cycleMonths = [8, 8, 6, 6, 6]; // months per cycle
  const month = cycleMonths[Math.min(schedule.cycle_number, cycleMonths.length - 1)];
  const price = 599; // ₹599 inclusive

  await db.query(
    `UPDATE maintenance_schedules SET reminder_count = reminder_count + 1, last_reminded_at = now(), status = 'reminded'
     WHERE id = $1`,
    [schedule.id]
  );

  await session.setSession(schedule.customer_phone, {
    flow: 'maintenance',
    step: 'awaiting_confirm',
    context_data: {
      schedule_id: schedule.id,
      unit_id: schedule.unit_id,
      unit_code: schedule.unit_code,
      customer_id: schedule.customer_id,
      zone_id: schedule.zone_id,
      price_paise: price * 100,
      cycle_number: schedule.cycle_number,
    }
  });

  await wa.sendButtons(schedule.customer_phone,
    `💧 *Filter Replacement Due!*\n\n` +
    `Hi! Your Knite RO *${schedule.unit_code}* is due for its ${month}-month pre-filter replacement.\n\n` +
    `✅ Regular filter changes keep your water pure and extend unit life.\n\n` +
    `🔧 Filter + Installation: *₹${price}* (all inclusive)\n\n` +
    `Reminder ${schedule.reminder_count + 1}/3`,
    [
      { id: 'MAINTENANCE_YES', title: '✅ Yes, Schedule Now' },
      { id: 'MAINTENANCE_NO', title: '🔔 Remind Me Later' },
    ]
  );
}

/**
 * Customer confirmed maintenance - initiate payment
 */
async function handleConfirm(phone, ctx) {
  await session.setSession(phone, {
    flow: 'maintenance',
    step: 'awaiting_payment',
    context_data: ctx
  });

  // In MVP: simulate payment with a button
  await wa.sendButtons(phone,
    `💳 *Complete Payment*\n\n` +
    `Amount: ₹${Math.round(ctx.price_paise / 100)}\n` +
    `Unit: ${ctx.unit_code}\n\n` +
    `Pay via UPI:\n` +
    `📲 UPI ID: *knite@upi*\n` +
    `Amount: ₹${Math.round(ctx.price_paise / 100)}\n\n` +
    `_(In production: tap link for instant payment)_\n\nClick below once payment is done:`,
    [
      { id: 'PAYMENT_DONE', title: '✅ Payment Done' },
      { id: 'PAYMENT_CANCEL', title: '❌ Cancel' },
    ]
  );
}

/**
 * Payment confirmed - schedule maintenance job
 */
async function handlePaymentConfirmed(phone, ctx) {
  // Record payment
  await db.query(
    `INSERT INTO payments (unit_id, customer_id, amount_paise, status, method, reference)
     VALUES ($1, $2, $3, 'completed', 'upi', 'simulator_payment')
     `,
    [ctx.unit_id, ctx.customer_id, 59900]
  ).catch(() => {}); // Payment insert is best-effort in MVP

  const hour = new Date().getHours();
  const buttons = [];
  if (hour < 16) buttons.push({ id: 'MAINT_ASAP', title: '⚡ ASAP' });
  buttons.push(
    { id: 'MAINT_MORNING', title: '🌅 Tomorrow 9-11 AM' },
    { id: 'MAINT_MIDDAY', title: '☀️ Tomorrow 12-2 PM' },
    { id: 'MAINT_EVENING', title: '🌆 Tomorrow 4-6 PM' }
  );

  await session.setSession(phone, {
    flow: 'maintenance',
    step: 'awaiting_slot',
    context_data: ctx
  });

  await wa.sendButtons(phone,
    `✅ *Payment received!*\n\n📅 When would you like the filter replacement?`,
    buttons
  );
}

/**
 * Slot selected - create and dispatch maintenance job
 */
async function handleSlot(phone, text, ctx) {
  const slotMap = {
    'MAINT_ASAP': { isAsap: true, label: 'ASAP' },
    'MAINT_MORNING': { slot: 'morning', label: 'Tomorrow 9-11 AM' },
    'MAINT_MIDDAY': { slot: 'midday', label: 'Tomorrow 12-2 PM' },
    'MAINT_EVENING': { slot: 'evening', label: 'Tomorrow 4-6 PM' },
  };

  let slot = null;
  for (const [k, v] of Object.entries(slotMap)) {
    if (text.includes(k)) { slot = v; break; }
  }
  if (!slot) slot = slotMap['MAINT_MORNING'];

  const now = new Date();
  let scheduledStart;
  if (slot.isAsap) {
    scheduledStart = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  } else {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const hours = { morning: 9, midday: 12, evening: 16 };
    scheduledStart = new Date(tomorrow.setHours(hours[slot.slot], 0, 0, 0));
  }

  const otpCode = otp.generateOTP();
  const otpHash = await otp.hashOTP(otpCode);

  const jobResult = await db.query(
    `INSERT INTO jobs (unit_id, customer_id, zone_id, type, status, scheduled_start, otp, otp_hash,
      payout_paise, customer_charge_paise, is_warranty)
     VALUES ($1,$2,$3,'maintenance',$4,$5,$6,$7,25000,$8,false) RETURNING *`,
    [
      ctx.unit_id, ctx.customer_id, ctx.zone_id,
      slot.isAsap ? 'broadcasting' : 'scheduled',
      scheduledStart, otpCode, otpHash,
      ctx.price_paise
    ]
  );
  const job = jobResult.rows[0];

  await db.query(
    `UPDATE units SET status = 'maintenance_dispatched', updated_at = now() WHERE id = $1`,
    [ctx.unit_id]
  );
  await db.query(
    `UPDATE maintenance_schedules SET status = 'completed' WHERE id = $1`,
    [ctx.schedule_id]
  );

  if (slot.isAsap) {
    await broadcastJob(job, ctx.zone_id);
  }

  await session.clearSession(phone);
  await wa.sendText(phone,
    `✅ *Filter Replacement Scheduled!*\n\n` +
    `🔄 Unit: ${ctx.unit_code}\n` +
    `📅 Slot: ${slot.label}\n` +
    `🔐 Technician OTP: *${otpCode}*\n\n` +
    `The technician will bring: Sediment + Carbon filters + TDS meter\n\n` +
    `You'll be notified once assigned! 💧`
  );
}

/**
 * Snooze maintenance - try again in 30 days
 */
async function handleSnooze(phone, ctx) {
  const snoozedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.query(
    `UPDATE maintenance_schedules
     SET status = 'snoozed', snoozed_until = $1
     WHERE id = $2`,
    [snoozedUntil, ctx.schedule_id]
  );

  await session.clearSession(phone);
  await wa.sendText(phone,
    `👍 No problem! We'll remind you again in *30 days*.\n\n` +
    `💡 Tip: Regular filter changes every 8 months ensure your water stays pure.`
  );
}

/**
 * Create first maintenance schedule after installation
 */
async function createInitialSchedule(unitId, customerId) {
  const dueAt = new Date(Date.now() + 8 * 30 * 24 * 60 * 60 * 1000); // 8 months

  await db.query(
    `INSERT INTO maintenance_schedules (unit_id, customer_id, cycle_number, due_at, status)
     VALUES ($1, $2, 1, $3, 'pending')`,
    [unitId, customerId, dueAt]
  );
}

/**
 * Create next maintenance schedule after completion
 */
async function createNextSchedule(unitId, customerId, currentCycle) {
  const nextCycle = currentCycle + 1;
  const dueAt = new Date(Date.now() + 8 * 30 * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO maintenance_schedules (unit_id, customer_id, cycle_number, due_at, status)
     VALUES ($1, $2, $3, $4, 'pending')`,
    [unitId, customerId, nextCycle, dueAt]
  );

  await db.query(
    `UPDATE units SET maintenance_cycle = $1, next_maintenance_at = $2, updated_at = now()
     WHERE id = $3`,
    [nextCycle, dueAt, unitId]
  );
}

module.exports = {
  checkAndNotify,
  handleConfirm,
  handlePaymentConfirmed,
  handleSlot,
  handleSnooze,
  createInitialSchedule,
  createNextSchedule,
};
