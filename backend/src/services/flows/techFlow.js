/**
 * Flow 4: Technician Onboarding + Daily Operations
 *
 * Onboarding steps:
 *   awaiting_name → awaiting_state → awaiting_district → awaiting_areas → awaiting_kyc
 *
 * State / District / Area selection all use WhatsApp list messages (dropdown style).
 * District and Area both support multi-select (tap items, tap Done when finished).
 */
const db = require('../../db');
const wa = require('../whatsappService');
const session = require('../sessionService');
const otp = require('../otpService');

const AREA_MAX = 200; // numbered text has no WhatsApp API limit

// ─────────────────────────────────────────────
// ONBOARDING
// ─────────────────────────────────────────────

async function startOnboarding(phone) {
  const existingResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [phone]);
  const existing = existingResult.rows[0];

  if (existing && existing.is_verified) {
    await wa.sendText(phone,
      `✅ You're already registered as *${existing.name}*!\n\n` +
      `Status: ${existing.is_active ? '🟢 Active' : '🔴 Inactive'}\n` +
      `Rating: ⭐ ${existing.rating}\n` +
      `Jobs Completed: ${existing.jobs_completed}\n\n` +
      `You'll receive job notifications automatically when jobs are available in your zone.`
    );
    return;
  }

  if (existing && !existing.is_verified) {
    await wa.sendText(phone,
      `⏳ Your registration for *${existing.name || 'your account'}* is pending admin verification.\n\nWe'll notify you once approved!`
    );
    return;
  }

  await session.setSession(phone, {
    flow: 'tech_onboarding',
    step: 'awaiting_name',
    actor_type: 'technician',
    context_data: {}
  });

  await wa.sendText(phone,
    `👋 *Welcome to the Knite Technician Network!*\n\n` +
    `💰 Earn ₹300-500 per job\n` +
    `🕐 No fixed hours - work when you want\n` +
    `📱 100% WhatsApp - no app needed\n\n` +
    `Let's get you registered. What is your *full name*?`
  );
}

// ─────────────────────────────────────────────
// Step 1: Name → show state list
// ─────────────────────────────────────────────

async function handleName(phone, name, ctx) {
  if (name.trim().length < 3) {
    await wa.sendText(phone, `Please enter your full name (at least 3 characters):`);
    return;
  }

  await session.setSession(phone, {
    flow: 'tech_onboarding',
    step: 'awaiting_state',
    context_data: { name: name.trim() }
  });

  await sendStateList(phone);
}

async function sendStateList(phone) {
  const result = await db.query(
    `SELECT DISTINCT state FROM india_pincodes WHERE state IS NOT NULL ORDER BY state`
  );
  const states = result.rows.map(r => r.state);
  const lines = states.map((s, i) => `${i + 1}. ${s}`).join('\n');
  await wa.sendText(phone, `📍 Which *state* do you work in?\n\n${lines}\n\nReply with the number.`);
}

// ─────────────────────────────────────────────
// Step 2: State → show district multi-select list
// ─────────────────────────────────────────────

async function handleState(phone, text, ctx) {
  const num = parseInt(text.trim());

  const countResult = await db.query(`SELECT COUNT(DISTINCT state) AS cnt FROM india_pincodes WHERE state IS NOT NULL`);
  const total = parseInt(countResult.rows[0].cnt);

  if (isNaN(num) || num < 1 || num > total) {
    await wa.sendText(phone, `❌ Please enter a number between 1 and ${total}.`);
    await sendStateList(phone);
    return;
  }

  const result = await db.query(
    `SELECT DISTINCT state FROM india_pincodes WHERE state IS NOT NULL ORDER BY state LIMIT 1 OFFSET $1`,
    [num - 1]
  );
  const selectedState = result.rows[0]?.state;
  if (!selectedState) { await sendStateList(phone); return; }

  await session.setSession(phone, {
    flow: 'tech_onboarding',
    step: 'awaiting_district',
    context_data: { state: selectedState, selected_districts: [] }
  });

  await sendDistrictList(phone, selectedState, []);
}

async function sendDistrictList(phone, state, selectedDistricts) {
  const result = await db.query(
    `SELECT DISTINCT district FROM india_pincodes WHERE state = $1 AND district IS NOT NULL ORDER BY district`,
    [state]
  );
  const districts = result.rows.map(r => r.district);
  const lines = districts.map((d, i) => `${i + 1}. ${d}`).join('\n');
  const selectedStr = selectedDistricts.length > 0
    ? `✅ *Selected (${selectedDistricts.length}):* ${selectedDistricts.join(', ')}\n\n`
    : '';
  await wa.sendText(phone,
    `${selectedStr}🏙️ *${state}* — Select district(s):\n\n${lines}\n\nReply with a number to add. Type *DONE* when finished.`
  );
}

// ─────────────────────────────────────────────
// Step 3: District multi-select
// ─────────────────────────────────────────────

async function handleDistrict(phone, text, ctx) {
  const upper = text.trim().toUpperCase();

  if (upper === 'DONE' || upper === 'DIST_DONE') {
    if (!ctx.selected_districts || ctx.selected_districts.length === 0) {
      await wa.sendText(phone, `Please select at least one district first.`);
      await sendDistrictList(phone, ctx.state, []);
      return;
    }
    await session.setSession(phone, {
      flow: 'tech_onboarding',
      step: 'awaiting_areas',
      context_data: { selected_areas: [] }
    });
    await sendAreaList(phone, ctx.state, ctx.selected_districts, []);
    return;
  }

  const num = parseInt(text.trim());
  const distCountResult = await db.query(
    `SELECT COUNT(DISTINCT district) AS cnt FROM india_pincodes WHERE state = $1 AND district IS NOT NULL`,
    [ctx.state]
  );
  const distTotal = parseInt(distCountResult.rows[0].cnt);

  if (isNaN(num) || num < 1 || num > distTotal) {
    await wa.sendText(phone, `❌ Please enter a number between 1 and ${distTotal}.`);
    await sendDistrictList(phone, ctx.state, ctx.selected_districts || []);
    return;
  }

  const result = await db.query(
    `SELECT DISTINCT district FROM india_pincodes WHERE state = $1 AND district IS NOT NULL ORDER BY district LIMIT 1 OFFSET $2`,
    [ctx.state, num - 1]
  );
  const selectedDistrict = result.rows[0]?.district;
  if (!selectedDistrict) { await sendDistrictList(phone, ctx.state, ctx.selected_districts || []); return; }

  const existing = ctx.selected_districts || [];
  const newDistricts = existing.includes(selectedDistrict) ? existing : [...existing, selectedDistrict];

  await session.setSession(phone, {
    flow: 'tech_onboarding',
    step: 'awaiting_district',
    context_data: { selected_districts: newDistricts }
  });
  await sendDistrictList(phone, ctx.state, newDistricts);
}

// ─────────────────────────────────────────────
// Step 4: Area multi-select (across all selected districts)
// ─────────────────────────────────────────────

async function handleAreaSelection(phone, text, ctx) {
  const upper = text.trim().toUpperCase();

  // Done
  if (upper === 'DONE' || upper === 'AREA_DONE') {
    if (!ctx.selected_areas || ctx.selected_areas.length === 0) {
      await wa.sendText(phone, `Please select at least one area first.`);
      await sendAreaPage(phone, ctx.state, ctx.selected_districts, [], ctx.area_page || 0);
      return;
    }

    // Group selected areas by district → create/upsert one zone per district
    const byDistrict = {};
    for (const area of ctx.selected_areas) {
      if (!byDistrict[area.district]) byDistrict[area.district] = [];
      byDistrict[area.district].push(area.pincode);
    }

    const zoneIds = [];
    const zoneNames = [];
    for (const [district, pincodes] of Object.entries(byDistrict)) {
      const zoneId = await upsertZone(ctx.state, district, pincodes);
      zoneIds.push(zoneId);
      zoneNames.push(district);
    }

    const areasSummary = ctx.selected_areas.map(a =>
      ctx.selected_districts.length > 1 ? `${a.area_name} (${a.district})` : a.area_name
    ).join(', ');

    await session.setSession(phone, {
      flow: 'tech_onboarding',
      step: 'awaiting_kyc',
      context_data: {
        home_zone_id: zoneIds[0],
        home_zone_name: zoneNames.join(', '),
        all_zone_ids: zoneIds,
        areas_summary: areasSummary,
      }
    });

    await wa.sendText(phone,
      `✅ *Work zones registered!*\n\n` +
      `📍 ${zoneNames.join(', ')}, ${ctx.state}\n` +
      `🏘️ Areas (${ctx.selected_areas.length}): ${areasSummary}\n\n` +
      `📄 *KYC Verification Required*\n\n` +
      `Please send a clear photo of your *Aadhaar card (front side)*.\n\n` +
      `_Your document is stored securely and only visible to Knite admin._`
    );
    return;
  }

  // Number input → pick area by position
  const num = parseInt(text.trim());
  const areaCountResult = await db.query(
    `SELECT COUNT(*) AS cnt FROM (
       SELECT DISTINCT area_name, district FROM india_pincodes
       WHERE state = $1 AND district = ANY($2::text[]) AND area_name IS NOT NULL
     ) t`,
    [ctx.state, ctx.selected_districts]
  );
  const areaTotal = parseInt(areaCountResult.rows[0].cnt);

  if (isNaN(num) || num < 1 || num > areaTotal) {
    await wa.sendText(phone, `❌ Please enter a number between 1 and ${areaTotal}.`);
    await sendAreaList(phone, ctx.state, ctx.selected_districts, ctx.selected_areas || []);
    return;
  }

  const areaResult = await db.query(
    `SELECT id, area_name, pincode, district FROM india_pincodes
     WHERE state = $1 AND district = ANY($2::text[]) AND area_name IS NOT NULL
     ORDER BY district, area_name
     LIMIT 1 OFFSET $3`,
    [ctx.state, ctx.selected_districts, num - 1]
  );
  const area = areaResult.rows[0];
  if (!area) { await sendAreaList(phone, ctx.state, ctx.selected_districts, ctx.selected_areas || []); return; }

  const selectedAreas = ctx.selected_areas || [];
  const alreadySelected = selectedAreas.some(a => a.id === area.id);
  const newAreas = alreadySelected ? selectedAreas : [...selectedAreas, area];

  await session.setSession(phone, {
    flow: 'tech_onboarding',
    step: 'awaiting_areas',
    context_data: { selected_areas: newAreas }
  });
  await sendAreaList(phone, ctx.state, ctx.selected_districts, newAreas);
}

async function sendAreaList(phone, state, districts, selectedAreas) {
  const result = await db.query(
    `SELECT id, area_name, pincode, district FROM india_pincodes
     WHERE state = $1 AND district = ANY($2::text[]) AND area_name IS NOT NULL
     ORDER BY district, area_name
     LIMIT $3`,
    [state, districts, AREA_MAX]
  );
  const areas = result.rows;
  const selectedIds = new Set((selectedAreas || []).map(a => a.id));

  const selectedStr = selectedAreas.length > 0
    ? `✅ *Selected (${selectedAreas.length}):* ${selectedAreas.map(a => districts.length > 1 ? `${a.area_name} (${a.district})` : a.area_name).join(', ')}\n\n`
    : '';

  const distLabel = districts.length > 1 ? districts.join(', ') : districts[0];
  const lines = areas.map((a, i) => `${i + 1}. ${selectedIds.has(a.id) ? '✓ ' : ''}${districts.length > 1 ? `${a.area_name} (${a.district})` : a.area_name}`).join('\n');
  await wa.sendText(phone,
    `${selectedStr}📍 *${distLabel}, ${state}* — Select areas:\n\n${lines}\n\nReply with a number to add. Type *DONE* when finished.`
  );
}

// ─────────────────────────────────────────────
// Zone helper
// ─────────────────────────────────────────────

async function upsertZone(state, district, pincodes) {
  const existing = await db.query(
    `SELECT id, pincodes FROM zones WHERE name = $1 LIMIT 1`,
    [district]
  );
  if (existing.rows.length > 0) {
    const merged = [...new Set([...(existing.rows[0].pincodes || []), ...pincodes])];
    await db.query(`UPDATE zones SET pincodes = $1 WHERE id = $2`, [merged, existing.rows[0].id]);
    return existing.rows[0].id;
  }
  const result = await db.query(
    `INSERT INTO zones (name, city, pincodes, is_active) VALUES ($1, $2, $3, true) RETURNING id`,
    [district, state, pincodes]
  );
  return result.rows[0].id;
}

// ─────────────────────────────────────────────
// Step 5: KYC
// ─────────────────────────────────────────────

async function handleKYC(phone, mediaUrl, ctx) {
  if (!mediaUrl) {
    await wa.sendText(phone, `Please send a *photo* of your Aadhaar card (front side):`);
    return;
  }

  const techResult = await db.query(
    `INSERT INTO technicians (phone, name, home_zone_id, is_verified, is_active, kyc_doc_url)
     VALUES ($1, $2, $3, false, false, $4)
     ON CONFLICT (phone) DO UPDATE SET name = $2, home_zone_id = $3, kyc_doc_url = $4
     RETURNING *`,
    [phone, ctx.name, ctx.home_zone_id, mediaUrl || 'simulator_upload']
  );
  const tech = techResult.rows[0];

  // Link technician to all selected zones
  for (const zoneId of (ctx.all_zone_ids || [ctx.home_zone_id])) {
    await db.query(
      `INSERT INTO technician_zones (technician_id, zone_id, is_home) VALUES ($1, $2, $3)
       ON CONFLICT (technician_id, zone_id) DO UPDATE SET is_home = $3`,
      [tech.id, zoneId, zoneId === ctx.home_zone_id]
    );
  }

  // Notify admin
  const adminResult = await db.query(`SELECT phone FROM customers WHERE phone = '919999999999'`);
  if (adminResult.rows[0]) {
    await wa.sendButtons(adminResult.rows[0].phone,
      `🆕 *New Technician Application*\n\n` +
      `👤 Name: ${ctx.name}\n` +
      `📱 Phone: ${phone}\n` +
      `📍 Zones: ${ctx.home_zone_name}\n` +
      `🏘️ Areas: ${ctx.areas_summary || 'N/A'}\n` +
      `🪪 KYC: ${mediaUrl ? 'Photo uploaded' : 'Pending'}\n\n` +
      `Tech ID: ${tech.id}`,
      [
        { id: `APPROVE_TECH_${tech.id}`, title: '✅ Approve' },
        { id: `REJECT_TECH_${tech.id}`, title: '❌ Reject' },
      ]
    );
  }

  await session.clearSession(phone);
  await wa.sendText(phone,
    `✅ *Registration submitted successfully!*\n\n` +
    `📋 Details:\n` +
    `• Name: ${ctx.name}\n` +
    `• Zones: ${ctx.home_zone_name}\n` +
    `• Areas: ${ctx.areas_summary || 'N/A'}\n` +
    `• KYC: Submitted\n\n` +
    `⏳ Our admin will review your application within 24 hours.\n` +
    `You'll receive a WhatsApp notification once approved! 🎉`
  );
}

// ─────────────────────────────────────────────
// JOB OPERATIONS
// ─────────────────────────────────────────────

async function handleJobAccept(phone, jobId) {
  const techResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [phone]);
  const tech = techResult.rows[0];

  if (!tech || !tech.is_active) {
    await wa.sendText(phone, `❌ You need to be a verified technician to accept jobs.`);
    return;
  }

  const result = await db.query(`SELECT accept_job_broadcast($1, $2) AS accepted`, [jobId, tech.id]);
  const accepted = result.rows[0].accepted;

  if (!accepted) {
    await wa.sendText(phone,
      `⚡ *Too late!* This job was already taken by another technician.\n\nStay tuned for the next one! 💪`
    );
    return;
  }

  const jobResult = await db.query(
    `SELECT j.*, u.unit_id as unit_code, u.install_address, c.phone as customer_phone, c.name as customer_name
     FROM jobs j
     JOIN units u ON u.id = j.unit_id
     JOIN customers c ON c.id = j.customer_id
     WHERE j.id = $1`,
    [jobId]
  );
  const job = jobResult.rows[0];
  const address = job.install_address || {};

  await db.query(
    `SELECT log_job_event($1, 'accepted', 'broadcasting', 'assigned', 'technician', $2, '{}')`,
    [jobId, tech.id]
  );

  await wa.sendButtons(phone,
    `🎉 *Job Confirmed!*\n\n` +
    `📦 Unit: ${job.unit_code}\n` +
    `🏠 Address: ${address.raw || 'See details'}\n` +
    `📞 Customer: ${job.customer_name || job.customer_phone}\n` +
    `💰 Payout: ₹${Math.round(job.payout_paise / 100)}\n\n` +
    `🔐 Ask customer for OTP before starting work.\n\n` +
    `_Head to the location now!_`,
    [
      { id: `ARRIVED_${jobId}`, title: '📍 I Have Arrived' },
      { id: `CANCEL_JOB_${jobId}`, title: '❌ Cancel' },
    ]
  );

  await wa.sendText(job.customer_phone,
    `👨‍🔧 *Technician Assigned!*\n\n` +
    `Name: ${tech.name}\n` +
    `Phone: ${tech.phone}\n` +
    `⭐ Rating: ${tech.rating}\n\n` +
    `They are on their way! Share the OTP *only when they arrive.*`
  );
}

async function handleJobDecline(phone, jobId) {
  const techResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [phone]);
  if (!techResult.rows[0]) return;

  await db.query(
    `UPDATE job_broadcasts SET status = 'declined', responded_at = now()
     WHERE job_id = $1 AND technician_id = $2`,
    [jobId, techResult.rows[0].id]
  );

  await wa.sendText(phone, `👍 Got it! You've declined this job. We'll notify you of future opportunities.`);
}

async function handleArrived(phone, jobId) {
  const techResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [phone]);
  if (!techResult.rows[0]) return;

  await session.setSession(phone, {
    flow: 'tech_job',
    step: 'awaiting_otp',
    context_data: { job_id: jobId, tech_id: techResult.rows[0].id }
  });

  await wa.sendText(phone, `📍 *Arrival confirmed!*\n\nPlease ask the customer for the *6-digit OTP* and enter it here:`);
}

async function handleOTPVerification(phone, otpInput, ctx) {
  const jobResult = await db.query(`SELECT * FROM jobs WHERE id = $1`, [ctx.job_id]);
  const job = jobResult.rows[0];
  if (!job) { await wa.sendText(phone, `❌ Job not found.`); return; }

  const isValid = await otp.verifyOTP(otpInput.trim(), job.otp_hash);
  if (!isValid) {
    await wa.sendText(phone, `❌ *Invalid OTP!* Please ask the customer to check and share again.`);
    return;
  }

  await db.query(
    `UPDATE jobs SET status = 'in_progress', started_at = now(), otp_verified = true, updated_at = now() WHERE id = $1`,
    [ctx.job_id]
  );
  await db.query(
    `SELECT log_job_event($1, 'otp_verified', 'assigned', 'in_progress', 'technician', $2, '{}')`,
    [ctx.job_id, ctx.tech_id]
  );

  await session.setSession(phone, {
    flow: 'tech_job',
    step: 'awaiting_completion_photos',
    context_data: { ...ctx, photos: [] }
  });

  await wa.sendText(phone,
    `✅ *OTP verified! Work started.*\n\n` +
    `Complete the ${job.type} and then send *2 photos*:\n` +
    `📸 1. Before/during work\n📸 2. Completed installation/repair\n\n` +
    `_(Required for payment release)_`
  );
}

async function handleCompletionPhoto(phone, mediaUrl, ctx) {
  const photos = [...(ctx.photos || []), mediaUrl];

  if (photos.length < 2) {
    await session.updateContext(phone, { photos });
    await wa.sendText(phone, `📸 Photo ${photos.length}/2 received. Send ${2 - photos.length} more photo(s) to complete.`);
    return;
  }

  await db.query(
    `UPDATE jobs SET status = 'pending_verification', proof_photos = $1, updated_at = now() WHERE id = $2`,
    [JSON.stringify(photos), ctx.job_id]
  );

  const jobResult = await db.query(
    `SELECT j.*, c.phone as customer_phone, u.unit_id as unit_code
     FROM jobs j JOIN customers c ON c.id = j.customer_id JOIN units u ON u.id = j.unit_id
     WHERE j.id = $1`,
    [ctx.job_id]
  );
  const job = jobResult.rows[0];

  await db.query(
    `SELECT log_job_event($1, 'work_completed', 'in_progress', 'pending_verification', 'technician', $2, $3)`,
    [ctx.job_id, ctx.tech_id, JSON.stringify({ photos })]
  );

  await session.clearSession(phone);
  await wa.sendText(phone,
    `✅ *All photos received! Job submitted for customer verification.*\n\n` +
    `💰 Payment will be released after customer confirms.\n_(Auto-released in 4 hours if no response)_`
  );

  await wa.sendButtons(job.customer_phone,
    `🔧 *Work Completed on ${job.unit_code}!*\n\n` +
    `Your technician has completed the ${job.type} and submitted photos.\n\nWas the work done satisfactorily?`,
    [
      { id: `VERIFY_YES_${ctx.job_id}`, title: '✅ Yes, All Good!' },
      { id: `VERIFY_NO_${ctx.job_id}`, title: '❌ No, Issue Remains' },
    ]
  );
}

async function handleAdminApproval(phone, techId, approved) {
  if (approved) {
    await db.query(
      `UPDATE technicians SET is_verified = true, is_active = true, updated_at = now() WHERE id = $1`,
      [techId]
    );
    const techResult = await db.query(`SELECT * FROM technicians WHERE id = $1`, [techId]);
    const tech = techResult.rows[0];
    await wa.sendText(phone, `✅ Technician *${tech.name}* (${tech.phone}) has been *approved and activated*.`);
    await wa.sendText(tech.phone,
      `🎉 *Congratulations ${tech.name}!*\n\nYour Knite technician account is now *ACTIVE*! ✅\n\n` +
      `You'll start receiving job notifications in your zone.\n\n` +
      `💡 Tips:\n• Accept jobs quickly - first accepted wins!\n` +
      `• Maintain high ratings for priority job access\n• Typical earnings: ₹700-1,600/day\n\nWelcome to the team! 🔧`
    );
  } else {
    await db.query(`UPDATE technicians SET updated_at = now() WHERE id = $1`, [techId]);
    const techResult = await db.query(`SELECT * FROM technicians WHERE id = $1`, [techId]);
    const tech = techResult.rows[0];
    await wa.sendText(phone, `❌ Technician *${tech?.name}* application rejected.`);
    if (tech) {
      await wa.sendText(tech.phone,
        `❌ Your application needs a clearer Aadhaar photo.\n\nPlease type *REGISTER TECH* to resubmit.`
      );
    }
  }
}

module.exports = {
  startOnboarding,
  handleName,
  handleState,
  handleDistrict,
  handleAreaSelection,
  handleKYC,
  handleJobAccept,
  handleJobDecline,
  handleArrived,
  handleOTPVerification,
  handleCompletionPhoto,
  handleAdminApproval,
};
