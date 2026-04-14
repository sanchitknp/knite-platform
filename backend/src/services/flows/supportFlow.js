/**
 * Flow 2: Customer Support & Repairs
 * Triggered by: support keywords (leak, help, problem, etc.)
 */
const db = require('../../db');
const wa = require('../whatsappService');
const session = require('../sessionService');
const zone = require('../zoneService');
const otp = require('../otpService');
const media = require('../mediaService');
const { broadcastJob } = require('./installationFlow');

const SUPPORT_KEYWORDS = [
  'leak', 'leaking', 'help', 'problem', 'issue', 'repair', 'fix',
  'paani', 'water', 'noise', 'smell', 'taste', 'blink', 'light',
  'not working', 'broken', 'nahi', 'band', 'kharab', 'support',
  'complaint', 'damage', 'power', 'off'
];

function isSupport(text) {
  const lower = text.toLowerCase();
  return SUPPORT_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Entry point - detect support intent and start flow
 */
async function start(phone, customer) {
  // Find all active units for this customer
  const unitsResult = await db.query(
    `SELECT * FROM units WHERE customer_id = $1 AND status IN ('active', 'install_dispatched', 'maintenance_due', 'maintenance_dispatched')
     ORDER BY install_date DESC`,
    [customer.id]
  );
  const units = unitsResult.rows;

  if (units.length === 0) {
    await wa.sendButtons(phone,
      `Hi! I couldn't find any registered RO units on your account.\n\nScan the QR sticker on your Knite RO to get started.`,
      [{ id: 'MAIN_MENU', title: '🏠 Main Menu' }]
    );
    return;
  }

  if (units.length === 1) {
    await startTriage(phone, customer, units[0]);
  } else {
    // Show unit picker
    await session.setSession(phone, {
      flow: 'support',
      step: 'awaiting_unit_selection',
      context_data: { customer_id: customer.id }
    });

    const buttons = units.map((u, i) => ({
      id: `UNIT_${u.id}`,
      title: `${u.unit_id} - ${u.install_address?.raw?.substring(0, 25) || 'No address'}...`
    }));

    await wa.sendButtons(phone,
      `🔧 Which unit needs help?`,
      buttons
    );
  }
}

/**
 * Unit selected - start issue triage
 */
async function startTriage(phone, customer, unit) {
  // Mark unit as support_open
  await db.query(
    `UPDATE units SET status = 'support_open', updated_at = now() WHERE id = $1`,
    [unit.id]
  );

  await session.setSession(phone, {
    flow: 'support',
    step: 'awaiting_issue_type',
    context_data: {
      customer_id: customer.id,
      unit_id: unit.id,
      unit_code: unit.unit_id,
      zone_id: unit.zone_id,
    }
  });

  await wa.sendButtons(phone,
    `🔧 *What issue are you facing with ${unit.unit_id}?*`,
    [
      { id: 'ISSUE_LEAK', title: '💧 Water Leak' },
      { id: 'ISSUE_POWER', title: '⚡ No Power / Not Starting' },
      { id: 'ISSUE_TASTE', title: '🌊 Bad Taste / Smell' },
      { id: 'ISSUE_NOISE', title: '🔊 Unusual Noise' },
      { id: 'ISSUE_FLOW', title: '🚿 Low Water Flow' },
      { id: 'ISSUE_BLINK', title: '💡 Light Blinking' },
      { id: 'ISSUE_OTHER', title: '❓ Other' },
    ]
  );
}

/**
 * Handle issue type selection
 */
async function handleIssueType(phone, text, ctx) {
  const issueMap = {
    'ISSUE_LEAK': 'Water Leak',
    'ISSUE_POWER': 'No Power / Not Starting',
    'ISSUE_TASTE': 'Bad Taste / Smell',
    'ISSUE_NOISE': 'Unusual Noise',
    'ISSUE_FLOW': 'Low Water Flow',
    'ISSUE_BLINK': 'Light Blinking',
    'ISSUE_OTHER': 'Other',
  };

  let issueType = null;
  for (const [key, label] of Object.entries(issueMap)) {
    if (text.includes(key) || text.toLowerCase().includes(label.toLowerCase().split('/')[0].trim())) {
      issueType = label;
      break;
    }
  }

  if (!issueType) {
    if (text.includes('1') || text.toLowerCase().includes('leak')) issueType = 'Water Leak';
    else if (text.includes('2') || text.toLowerCase().includes('power')) issueType = 'No Power / Not Starting';
    else if (text.includes('3') || text.toLowerCase().includes('taste')) issueType = 'Bad Taste / Smell';
    else if (text.includes('4') || text.toLowerCase().includes('noise')) issueType = 'Unusual Noise';
    else if (text.includes('5') || text.toLowerCase().includes('flow')) issueType = 'Low Water Flow';
    else if (text.includes('6') || text.toLowerCase().includes('blink')) issueType = 'Light Blinking';
    else issueType = 'Other';
  }

  await session.setSession(phone, {
    flow: 'support',
    step: 'awaiting_media',
    context_data: { ...ctx, issue_type: issueType }
  });

  await wa.sendButtons(phone,
    `📸 *${issueType}* - understood!\n\nPlease send a *photo or short video* showing the issue.\n_(This helps the technician come prepared with the right parts)_`,
    [{ id: 'SKIP_MEDIA', title: '⏭️ Skip (describe below)' }]
  );
}

/**
 * Handle media or skip, then check warranty and dispatch
 */
async function handleMediaAndDispatch(phone, text, mediaId, ctx) {
  const issueMediaUrl = mediaId
    ? await media.storeMedia(mediaId, 'issue', `${phone}_${ctx.unit_id}`)
    : null;

  // Check warranty
  const unitResult = await db.query(`SELECT * FROM units WHERE id = $1`, [ctx.unit_id]);
  const unit = unitResult.rows[0];
  const isWarranty = unit.warranty_expires_at
    ? new Date(unit.warranty_expires_at) > new Date()
    : true; // If no expiry set, assume in warranty for MVP

  if (isWarranty) {
    await session.setSession(phone, {
      flow: 'support',
      step: 'awaiting_warranty_slot',
      context_data: { ...ctx, issue_media_url: issueMediaUrl, is_warranty: true }
    });

    const hour = new Date().getHours();
    const buttons = [];
    if (hour < 16) buttons.push({ id: 'ASAP', title: '⚡ ASAP (1-2 hours)' });
    buttons.push(
      { id: 'TOMORROW_MORNING', title: '🌅 Tomorrow 9-11 AM' },
      { id: 'TOMORROW_MIDDAY', title: '☀️ Tomorrow 12-2 PM' },
      { id: 'TOMORROW_EVENING', title: '🌆 Tomorrow 4-6 PM' }
    );

    await wa.sendButtons(phone,
      `✅ Your unit is *under warranty!* We'll send a technician to fix the *${ctx.issue_type}* — *FREE*.\n\n📅 When would you like the repair?`,
      buttons
    );
  } else {
    await session.setSession(phone, {
      flow: 'support',
      step: 'awaiting_oowarranty_confirm',
      context_data: { ...ctx, issue_media_url: issueMediaUrl, is_warranty: false }
    });

    await wa.sendButtons(phone,
      `⚠️ Your warranty has expired.\n\n` +
      `*Repair visit charge: ₹500* (parts extra, billed separately)\n\n` +
      `Would you like to proceed?`,
      [
        { id: 'PAY_REPAIR', title: '💳 Pay ₹500 & Schedule' },
        { id: 'CANCEL_REPAIR', title: '❌ Cancel' },
      ]
    );
  }
}

/**
 * Dispatch repair job
 */
async function dispatchRepair(phone, slotKey, ctx) {
  const slotMap = {
    'ASAP': { label: 'ASAP', isAsap: true },
    'TOMORROW_MORNING': { label: 'Tomorrow 9-11 AM', slot: 'morning' },
    'TOMORROW_MIDDAY': { label: 'Tomorrow 12-2 PM', slot: 'midday' },
    'TOMORROW_EVENING': { label: 'Tomorrow 4-6 PM', slot: 'evening' },
  };

  let slot = slotMap[slotKey];
  if (!slot) slot = slotMap['TOMORROW_MORNING'];

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

  const payout = ctx.is_warranty ? 30000 : 30000; // ₹300 base
  const charge = ctx.is_warranty ? 0 : 50000; // ₹500 if OOW

  const jobResult = await db.query(
    `INSERT INTO jobs (unit_id, customer_id, zone_id, type, status, issue_type, issue_media_url,
      scheduled_start, otp, otp_hash, payout_paise, customer_charge_paise, is_warranty)
     VALUES ($1,$2,$3,'repair',$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      ctx.unit_id, ctx.customer_id, ctx.zone_id,
      slot.isAsap ? 'broadcasting' : 'scheduled',
      ctx.issue_type, ctx.issue_media_url,
      scheduledStart, otpCode, otpHash,
      payout, charge, ctx.is_warranty
    ]
  );
  const job = jobResult.rows[0];

  await db.query(`UPDATE units SET status = 'support_open', updated_at = now() WHERE id = $1`, [ctx.unit_id]);

  if (slot.isAsap) {
    await broadcastJob(job, ctx.zone_id);
  }

  await session.clearSession(phone);
  await wa.sendText(phone,
    `✅ *Repair Scheduled!*\n\n` +
    `🔧 Issue: ${ctx.issue_type}\n` +
    `💰 Charge: ${ctx.is_warranty ? 'FREE (Warranty)' : '₹500'}\n` +
    `📅 Slot: ${slot.label}\n` +
    `🔐 OTP for technician: *${otpCode}*\n\n` +
    `You'll be notified once a technician is assigned. 🔧`
  );
}

module.exports = { start, isSupport, startTriage, handleIssueType, handleMediaAndDispatch, dispatchRepair };
