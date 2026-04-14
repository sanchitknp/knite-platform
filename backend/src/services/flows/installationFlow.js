/**
 * Flow 1: Zero-Touch Installation
 * Triggered by: "Install KN-XXXX"
 */
const db = require('../../db');
const wa = require('../whatsappService');
const session = require('../sessionService');
const zone = require('../zoneService');
const otp = require('../otpService');

/**
 * Entry point - called when "Install KN-XXXX" message received
 */
async function start(phone, unitId) {
  // Look up unit
  const unitResult = await db.query(`SELECT * FROM units WHERE unit_id = $1`, [unitId]);
  const unit = unitResult.rows[0];

  if (!unit) {
    await wa.sendText(phone, `❌ Unit ID *${unitId}* not found. Please check the QR sticker and try again.`);
    return;
  }

  if (unit.status !== 'shipped' && unit.status !== 'registered') {
    if (unit.status === 'active' || unit.status === 'install_dispatched') {
      // Could be ownership transfer
      const custResult = await db.query(`SELECT * FROM customers WHERE id = $1`, [unit.customer_id]);
      const existingCustomer = custResult.rows[0];
      if (existingCustomer && existingCustomer.phone !== phone) {
        await wa.sendButtons(phone,
          `⚠️ Unit *${unitId}* is already registered to another number.\n\nReply *TRANSFER* if you have purchased this unit and need ownership transferred.`,
          [{ id: 'TRANSFER', title: 'Request Transfer' }]
        );
        await session.setSession(phone, {
          flow: 'ownership_transfer',
          step: 'awaiting_transfer_request',
          context_data: { unit_id: unit.id, unit_code: unitId }
        });
        return;
      }
    }
    await wa.sendText(phone, `❌ Unit *${unitId}* cannot be registered (status: ${unit.status}). Please contact support.`);
    return;
  }

  // Create or find customer
  let customerResult = await db.query(
    `INSERT INTO customers (phone) VALUES ($1)
     ON CONFLICT (phone) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [phone]
  );
  const customer = customerResult.rows[0];

  // Transition: shipped -> registered
  const fromStatus = unit.status;
  await db.query(
    `UPDATE units SET status = 'registered', customer_id = $1, updated_at = now() WHERE id = $2`,
    [customer.id, unit.id]
  );
  await db.query(
    `SELECT log_unit_event($1, 'registered', $2, 'registered', 'customer', $3, '{}')`,
    [unit.id, fromStatus, customer.id]
  );

  await session.setSession(phone, {
    flow: 'installation',
    step: 'awaiting_flow',
    context_data: { unit_id: unit.id, unit_code: unitId, customer_id: customer.id }
  });

  await wa.sendText(phone, `🎉 Welcome to *Knite*! Unit *${unitId}* registered successfully.\n\nLet's find a technician near you.`);
  await sendInstallAddressFlow(phone);
}

// ─────────────────────────────────────────────
// Location selection via WhatsApp Flow (State + Pincode)
// ─────────────────────────────────────────────

async function sendInstallAddressFlow(phone) {
  const flowId = process.env.WA_FLOW_INSTALL_ADDRESS;
  const flowToken = `install_${phone}_${Date.now()}`;
  await wa.sendFlow(
    phone,
    `📍 *Where should we install your purifier?*\n\nPlease select your state and enter your 6-digit pincode.`,
    flowId,
    flowToken,
    'Enter Address'
  );
}

/**
 * Handle WhatsApp Flow response for installation address
 * flowPayload = { selected_state, full_address, pincode, share_location: "yes"|"skip" }
 */
async function handleInstallFlowResponse(phone, flowPayload, ctx) {
  const { selected_state, full_address, pincode, share_location } = flowPayload;

  if (!selected_state || !pincode) {
    await wa.sendText(phone, `❌ Address details are missing. Please try again.`);
    await sendInstallAddressFlow(phone);
    return;
  }

  // Validate pincode
  const pin = String(pincode).trim();
  if (!/^\d{6}$/.test(pin)) {
    await wa.sendText(phone, `❌ *${pin}* is not a valid 6-digit pincode. Please try again.`);
    await sendInstallAddressFlow(phone);
    return;
  }

  // Look up area/district/state by pincode from DB
  const areaResult = await db.query(
    `SELECT area_name, district, state FROM india_pincodes WHERE pincode = $1 LIMIT 1`,
    [pin]
  );

  let areaName, district, state;
  if (areaResult.rows[0]) {
    ({ area_name: areaName, district, state } = areaResult.rows[0]);
  } else {
    // Pincode not in DB — derive state from flow selection
    areaName = 'Unknown Area';
    district = 'Unknown District';
    state = selected_state.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // Build full address string: user's text + DB area + state
  const userLine = full_address ? full_address.trim() : '';
  const addressLine = userLine
    ? `${userLine}, ${areaName}, ${district}, ${state} — ${pin}`
    : `${areaName}, ${district}, ${state} — ${pin}`;

  const addressData = {
    full_address: userLine,
    area: areaName,
    district,
    state,
    pincode: pin,
    raw: addressLine
  };

  // Find zone by pincode
  const zoneResult = await zone.findZoneByPincode(pin);

  if (!zoneResult) {
    await db.query(
      `UPDATE units SET install_address = $1, status = 'pending_manual_action', updated_at = now() WHERE id = $2`,
      [JSON.stringify({ ...addressData, serviced: false }), ctx.unit_id]
    );
    await session.clearSession(phone);
    await wa.sendText(phone,
      `✅ *Address saved!*\n\n📍 ${addressLine}\n\n` +
      `🔧 We're working on expanding to your area. You'll receive an update within a few hours. Thank you for your patience! 🙏`
    );
    return;
  }

  await db.query(
    `UPDATE units SET install_address = $1, zone_id = $2, status = 'install_pending', updated_at = now() WHERE id = $3`,
    [JSON.stringify({ ...addressData, zone_id: zoneResult.id, zone_name: zoneResult.name }), zoneResult.id, ctx.unit_id]
  );

  const newCtx = { ...ctx, zone_id: zoneResult.id, zone_name: zoneResult.name, address: addressLine, pincode: pin };

  // If user opted to share location, ask for it before slot selection
  if (share_location === 'yes') {
    await session.setSession(phone, {
      flow: 'installation',
      step: 'awaiting_location',
      context_data: newCtx
    });
    await wa.sendText(phone,
      `✅ *Address saved!*\n\n📍 ${addressLine}\n\n` +
      `📌 *Please share your live location* so the technician can find you easily.\n\n` +
      `_Tap the 📎 attachment icon → Location → Send Your Current Location_\n\n` +
      `_(Or type *SKIP* to continue without sharing location)_`
    );
    return;
  }

  // No location sharing — go straight to slot selection
  await session.setSession(phone, {
    flow: 'installation',
    step: 'awaiting_slot',
    context_data: newCtx
  });
  await sendSlotButtons(phone, areaName, district, addressLine);
}

/**
 * Handle WhatsApp location message during installation
 */
async function handleInstallLocation(phone, location, ctx) {
  const { latitude, longitude, name, address } = location;

  // Save location to unit
  const locationData = { latitude, longitude, name: name || null, address: address || null };
  await db.query(
    `UPDATE units SET install_address = install_address || $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify({ location: locationData }), ctx.unit_id]
  );

  const areaName = ctx.address ? ctx.address.split(',')[0].trim() : 'your area';
  const district = ctx.address ? ctx.address.split(',')[1]?.trim() : '';

  await session.setSession(phone, {
    flow: 'installation',
    step: 'awaiting_slot',
    context_data: ctx
  });

  await wa.sendText(phone, `✅ *Location saved!* 📍`);
  await sendSlotButtons(phone, areaName, district, ctx.address);
}

/**
 * Send slot selection buttons
 */
async function sendSlotButtons(phone, areaName, district, addressLine) {
  const hour = new Date().getHours();
  const buttons = [];
  if (hour < 16) buttons.push({ id: 'ASAP', title: '⚡ ASAP (1-2 hours)' });
  buttons.push(
    { id: 'TOMORROW_MORNING', title: '🌅 Tomorrow 9-11 AM' },
    { id: 'TOMORROW_MIDDAY', title: '☀️ Tomorrow 12-2 PM' },
    { id: 'TOMORROW_EVENING', title: '🌆 Tomorrow 4-6 PM' }
  );
  await wa.sendButtons(phone,
    `✅ Great! We service *${areaName}${district ? ', ' + district : ''}*.\n\n📍 *${addressLine}*\n\n📅 When would you like the installation?`,
    buttons
  );
}

/**
 * Handle address input
 */
async function handleAddress(phone, text, ctx) {
  const pincode = zone.extractPincode(text);
  if (!pincode) {
    await wa.sendText(phone,
      `📍 Please include your *6-digit pincode* in the address.\n\n` +
      `_Example: Flat 4, Sector 74, Noida *201301*_`
    );
    return;
  }

  const zoneResult = await zone.findZoneByPincode(pincode);
  if (!zoneResult) {
    // Save address and mark for manual follow-up
    const addressData = { raw: text, pincode, serviced: false, saved_at: new Date().toISOString() };
    await db.query(
      `UPDATE units SET
         install_address = $1,
         status = 'pending_manual_action',
         updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(addressData), ctx.unit_id]
    );
    await db.query(
      `SELECT log_unit_event($1, 'unserviced_pincode', 'registered', 'pending_manual_action', 'system', $2, $3)`,
      [ctx.unit_id, ctx.customer_id, JSON.stringify({ pincode, address: text })]
    );
    await session.clearSession(phone);
    await wa.sendText(phone,
      `✅ *Address saved successfully!*\n\n` +
      `📍 We've registered your address for pincode *${pincode}*.\n\n` +
      `🔧 Our team is working on expanding to your area. You'll receive an *installation update within the next few hours*.\n\n` +
      `We'll reach out on this number as soon as a technician is available near you. Thank you for your patience! 🙏`
    );
    return;
  }

  // Store address and zone
  const addressData = { raw: text, pincode, zone_id: zoneResult.id, zone_name: zoneResult.name };
  await db.query(
    `UPDATE units SET install_address = $1, zone_id = $2, status = 'install_pending', updated_at = now() WHERE id = $3`,
    [JSON.stringify(addressData), zoneResult.id, ctx.unit_id]
  );
  await db.query(
    `SELECT log_unit_event($1, 'address_set', 'registered', 'install_pending', 'customer', $2, $3)`,
    [ctx.unit_id, ctx.customer_id, JSON.stringify({ pincode, zone: zoneResult.name })]
  );

  await session.setSession(phone, {
    flow: 'installation',
    step: 'awaiting_slot',
    context_data: { ...ctx, zone_id: zoneResult.id, zone_name: zoneResult.name, address: text }
  });

  // Build slot options
  const now = new Date();
  const hour = now.getHours();
  const buttons = [];

  if (hour < 16) {
    buttons.push({ id: 'ASAP', title: '⚡ ASAP (1-2 hours)' });
  }
  buttons.push(
    { id: 'TOMORROW_MORNING', title: '🌅 Tomorrow 9-11 AM' },
    { id: 'TOMORROW_MIDDAY', title: '☀️ Tomorrow 12-2 PM' },
    { id: 'TOMORROW_EVENING', title: '🌆 Tomorrow 4-6 PM' }
  );

  await wa.sendButtons(phone,
    `✅ Great! We service *${zoneResult.name}*.\n\n📅 When would you like the installation?`,
    buttons
  );
}

/**
 * Handle slot selection
 */
async function handleSlot(phone, text, ctx) {
  const slotMap = {
    'ASAP': { label: 'ASAP (within 1-2 hours)', hours: 0 },
    'asap': { label: 'ASAP (within 1-2 hours)', hours: 0 },
    '1': { label: 'ASAP (within 1-2 hours)', hours: 0 },
    'TOMORROW_MORNING': { label: 'Tomorrow 9-11 AM', slot: 'morning' },
    '2': { label: 'Tomorrow 9-11 AM', slot: 'morning' },
    'TOMORROW_MIDDAY': { label: 'Tomorrow 12-2 PM', slot: 'midday' },
    '3': { label: 'Tomorrow 12-2 PM', slot: 'midday' },
    'TOMORROW_EVENING': { label: 'Tomorrow 4-6 PM', slot: 'evening' },
    '4': { label: 'Tomorrow 4-6 PM', slot: 'evening' },
  };

  const input = text.trim().toUpperCase().replace(/[⚡🌅☀️🌆]/g, '').trim();
  let slotKey = Object.keys(slotMap).find(k =>
    k.toUpperCase() === input ||
    text.includes(k) ||
    text.toLowerCase().includes(slotMap[k]?.label?.toLowerCase()?.substring(0, 10))
  );

  // Also check by number
  if (!slotKey) {
    if (text.includes('ASAP') || text.includes('asap') || text === '1') slotKey = 'ASAP';
    else if (text.includes('Morning') || text.includes('morning') || text === '2') slotKey = 'TOMORROW_MORNING';
    else if (text.includes('Midday') || text.includes('midday') || text === '3') slotKey = 'TOMORROW_MIDDAY';
    else if (text.includes('Evening') || text.includes('evening') || text === '4') slotKey = 'TOMORROW_EVENING';
  }

  // Normalize numeric shortcuts to canonical keys
  const numericKeyMap = { '1': 'ASAP', '2': 'TOMORROW_MORNING', '3': 'TOMORROW_MIDDAY', '4': 'TOMORROW_EVENING' };
  if (numericKeyMap[slotKey]) slotKey = numericKeyMap[slotKey];

  if (!slotKey || !slotMap[slotKey]) {
    await wa.sendButtons(phone,
      `Please select a time slot:`,
      [
        { id: 'ASAP', title: '⚡ ASAP (1-2 hours)' },
        { id: 'TOMORROW_MORNING', title: '🌅 Tomorrow 9-11 AM' },
        { id: 'TOMORROW_MIDDAY', title: '☀️ Tomorrow 12-2 PM' },
        { id: 'TOMORROW_EVENING', title: '🌆 Tomorrow 4-6 PM' },
      ]
    );
    return;
  }

  const slot = slotMap[slotKey];
  const now = new Date();
  let scheduledStart = null;
  let scheduledEnd = null;
  let isAsap = false;

  if (slotKey === 'ASAP') {
    isAsap = true;
    scheduledStart = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    scheduledEnd = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  } else {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const slotHours = { morning: [9, 11], midday: [12, 14], evening: [16, 18] };
    const [startH, endH] = slotHours[slot.slot];
    scheduledStart = new Date(tomorrow.setHours(startH, 0, 0, 0));
    scheduledEnd = new Date(new Date(scheduledStart).setHours(endH));
  }

  // Generate OTP
  const otpCode = otp.generateOTP();
  const otpHash = await otp.hashOTP(otpCode);

  // Create job
  const jobResult = await db.query(
    `INSERT INTO jobs (unit_id, customer_id, zone_id, type, status, scheduled_start, scheduled_end, otp, otp_hash, payout_paise, is_warranty)
     VALUES ($1, $2, $3, 'install', $4, $5, $6, $7, $8, 40000, true)
     RETURNING *`,
    [
      ctx.unit_id,
      ctx.customer_id,
      ctx.zone_id,
      isAsap ? 'broadcasting' : 'scheduled',
      scheduledStart,
      scheduledEnd,
      otpCode,
      otpHash,
    ]
  );
  const job = jobResult.rows[0];

  // Update unit status
  await db.query(
    `UPDATE units SET status = 'install_dispatched', updated_at = now() WHERE id = $1`,
    [ctx.unit_id]
  );
  await db.query(
    `SELECT log_unit_event($1, 'slot_booked', 'install_pending', 'install_dispatched', 'customer', $2, $3)`,
    [ctx.unit_id, ctx.customer_id, JSON.stringify({ job_id: job.id, slot: slot.label })]
  );
  await db.query(
    `SELECT log_job_event($1, 'created', NULL, $2, 'customer', $3, '{}')`,
    [job.id, job.status, ctx.customer_id]
  );

  await session.setSession(phone, {
    flow: 'installation',
    step: 'awaiting_otp_verification',
    context_data: { ...ctx, job_id: job.id, otp: otpCode }
  });

  if (isAsap) {
    // Immediately broadcast to technicians
    await broadcastJob(job, ctx.zone_id);
    await wa.sendText(phone,
      `✅ *Installation Request Confirmed!*\n\n` +
      `📍 Zone: ${ctx.zone_name}\n` +
      `⏰ Slot: ASAP (within 1-2 hours)\n` +
      `🎉 Your *Happiness Code: ${otpCode}* _(share with technician only after work is done)_\n\n` +
      `We're finding a technician near you. You'll be notified once assigned! 🔧`
    );
  } else {
    await wa.sendText(phone,
      `✅ *Installation Scheduled!*\n\n` +
      `📍 Zone: ${ctx.zone_name}\n` +
      `📅 Slot: ${slot.label}\n` +
      `🎉 Your *Happiness Code: ${otpCode}* _(share with technician only after work is done)_\n\n` +
      `We'll assign a technician 30 minutes before your slot. You'll receive a confirmation! 🔧`
    );
  }

  await session.clearSession(phone);
}

/**
 * Broadcast job to eligible technicians in zone
 */
async function broadcastJob(job, zoneId) {
  const techs = await zone.getTechniciansInZone(zoneId);
  if (techs.length === 0) {
    console.log(`[BROADCAST] No techs in zone ${zoneId} for job ${job.id}`);
    return;
  }

  // Get unit details for message
  const unitResult = await db.query(`SELECT * FROM units WHERE id = $1`, [job.unit_id]);
  const unit = unitResult.rows[0];
  const address = unit.install_address || {};

  const slotText = job.scheduled_start
    ? new Date(job.scheduled_start).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    : 'ASAP';

  const typeLabel = { install: '🔧 Installation', repair: '🛠️ Repair', maintenance: '🔄 Maintenance' }[job.type];
  const zoneResult = await db.query(`SELECT name FROM zones WHERE id = $1`, [zoneId]);
  const zoneName = zoneResult.rows[0]?.name || 'Unknown Zone';

  for (const tech of techs) {
    await db.query(
      `INSERT INTO job_broadcasts (job_id, technician_id, status) VALUES ($1, $2, 'sent')
       ON CONFLICT (job_id, technician_id) DO NOTHING`,
      [job.id, tech.id]
    );

    await wa.sendButtons(tech.phone,
      `📣 *New Job Available!*\n\n` +
      `${typeLabel}\n` +
      `📍 Area: ${address.pincode || zoneName}\n` +
      `💰 Payout: ₹${Math.round(job.payout_paise / 100)}\n` +
      `🕐 Slot: ${slotText}\n\n` +
      `_Full address shared after acceptance_`,
      [
        { id: `ACCEPT_${job.id}`, title: '✅ Accept Job' },
        { id: `DECLINE_${job.id}`, title: '❌ Decline' },
      ]
    );
  }

  // Set expiry
  await db.query(
    `UPDATE jobs SET broadcast_expires_at = now() + INTERVAL '30 minutes', updated_at = now() WHERE id = $1`,
    [job.id]
  );

  console.log(`[BROADCAST] Sent job ${job.id} to ${techs.length} technicians`);
}

module.exports = { start, sendInstallAddressFlow, handleInstallFlowResponse, handleInstallLocation, sendSlotButtons, handleSlot, broadcastJob };
