/**
 * Flow 4: Technician Onboarding + Daily Operations
 * Triggered by: "REGISTER TECH" from tech, or ACCEPT/DECLINE job broadcasts
 */
const db = require('../../db');
const wa = require('../whatsappService');
const session = require('../sessionService');
const zone = require('../zoneService');
const otp = require('../otpService');

/**
 * Start technician onboarding
 */
async function startOnboarding(phone) {
  // Check if already registered
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

/**
 * Handle name input
 */
async function handleName(phone, name, ctx) {
  if (name.trim().length < 3) {
    await wa.sendText(phone, `Please enter your full name (at least 3 characters):`);
    return;
  }

  await session.setSession(phone, {
    flow: 'tech_onboarding',
    step: 'awaiting_zone',
    context_data: { ...ctx, name: name.trim() }
  });

  const zones = await zone.getAllZones();
  const buttons = zones.map((z, i) => ({ id: `ZONE_${z.id}`, title: z.name }));

  await wa.sendButtons(phone,
    `Great, *${name.trim()}*! 👍\n\nWhich area do you *primarily work* in?`,
    buttons
  );
}

/**
 * Handle zone selection
 */
async function handleZone(phone, text, ctx) {
  let zoneId = null;
  let zoneName = null;

  // Parse zone selection
  const match = text.match(/ZONE_([a-f0-9-]+)/i);
  if (match) {
    zoneId = match[1];
  } else {
    // Try to match by number or name
    const zones = await zone.getAllZones();
    const num = parseInt(text);
    if (!isNaN(num) && num > 0 && num <= zones.length) {
      zoneId = zones[num - 1].id;
      zoneName = zones[num - 1].name;
    } else {
      const matched = zones.find(z => text.toLowerCase().includes(z.name.toLowerCase().split(' ')[0]));
      if (matched) { zoneId = matched.id; zoneName = matched.name; }
    }
  }

  if (!zoneId) {
    const zones = await zone.getAllZones();
    const buttons = zones.map(z => ({ id: `ZONE_${z.id}`, title: z.name }));
    await wa.sendButtons(phone, `Please select your primary work area:`, buttons);
    return;
  }

  if (!zoneName) {
    const zoneResult = await db.query(`SELECT name FROM zones WHERE id = $1`, [zoneId]);
    zoneName = zoneResult.rows[0]?.name;
  }

  await session.setSession(phone, {
    flow: 'tech_onboarding',
    step: 'awaiting_kyc',
    context_data: { ...ctx, home_zone_id: zoneId, home_zone_name: zoneName }
  });

  await wa.sendText(phone,
    `✅ *${zoneName}* selected as your primary zone!\n\n` +
    `📄 *KYC Verification Required*\n\n` +
    `Please send a clear photo of your *Aadhaar card (front side)*.\n\n` +
    `_Your document is stored securely and only visible to Knite admin._`
  );
}

/**
 * Handle KYC document upload
 */
async function handleKYC(phone, mediaUrl, ctx) {
  if (!mediaUrl) {
    await wa.sendText(phone, `Please send a *photo* of your Aadhaar card (front side):`);
    return;
  }

  // Create technician record (pending verification)
  const techResult = await db.query(
    `INSERT INTO technicians (phone, name, home_zone_id, is_verified, is_active, kyc_doc_url)
     VALUES ($1, $2, $3, false, false, $4)
     ON CONFLICT (phone) DO UPDATE SET name = $2, home_zone_id = $3, kyc_doc_url = $4
     RETURNING *`,
    [phone, ctx.name, ctx.home_zone_id, mediaUrl || 'simulator_upload']
  );
  const tech = techResult.rows[0];

  // Add home zone
  await db.query(
    `INSERT INTO technician_zones (technician_id, zone_id, is_home) VALUES ($1, $2, true)
     ON CONFLICT (technician_id, zone_id) DO UPDATE SET is_home = true`,
    [tech.id, ctx.home_zone_id]
  );

  // Notify admin
  const adminResult = await db.query(`SELECT phone FROM customers WHERE phone = '919999999999'`);
  if (adminResult.rows[0]) {
    await wa.sendButtons(adminResult.rows[0].phone,
      `🆕 *New Technician Application*\n\n` +
      `👤 Name: ${ctx.name}\n` +
      `📱 Phone: ${phone}\n` +
      `📍 Zone: ${ctx.home_zone_name}\n` +
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
    `• Zone: ${ctx.home_zone_name}\n` +
    `• KYC: Submitted\n\n` +
    `⏳ Our admin will review your application within 24 hours.\n` +
    `You'll receive a WhatsApp notification once approved! 🎉`
  );
}

/**
 * Handle job acceptance by technician
 */
async function handleJobAccept(phone, jobId) {
  const techResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [phone]);
  const tech = techResult.rows[0];

  if (!tech || !tech.is_active) {
    await wa.sendText(phone, `❌ You need to be a verified technician to accept jobs.`);
    return;
  }

  // Atomic acceptance
  const result = await db.query(
    `SELECT accept_job_broadcast($1, $2) AS accepted`,
    [jobId, tech.id]
  );
  const accepted = result.rows[0].accepted;

  if (!accepted) {
    await wa.sendText(phone,
      `⚡ *Too late!* This job was already taken by another technician.\n\nStay tuned for the next one! 💪`
    );
    return;
  }

  // Get full job + unit + customer details
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

  // Notify customer
  await wa.sendText(job.customer_phone,
    `👨‍🔧 *Technician Assigned!*\n\n` +
    `Name: ${tech.name}\n` +
    `Phone: ${tech.phone}\n` +
    `⭐ Rating: ${tech.rating}\n\n` +
    `They are on their way! Share the OTP *only when they arrive.*`
  );
}

/**
 * Handle job declined by technician
 */
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

/**
 * Handle technician arrived - ask for OTP
 */
async function handleArrived(phone, jobId) {
  const techResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [phone]);
  if (!techResult.rows[0]) return;

  await session.setSession(phone, {
    flow: 'tech_job',
    step: 'awaiting_otp',
    context_data: { job_id: jobId, tech_id: techResult.rows[0].id }
  });

  await wa.sendText(phone,
    `📍 *Arrival confirmed!*\n\nPlease ask the customer for the *6-digit OTP* and enter it here:`
  );
}

/**
 * Handle OTP verification by technician
 */
async function handleOTPVerification(phone, otpInput, ctx) {
  const jobResult = await db.query(`SELECT * FROM jobs WHERE id = $1`, [ctx.job_id]);
  const job = jobResult.rows[0];

  if (!job) {
    await wa.sendText(phone, `❌ Job not found.`);
    return;
  }

  const isValid = await otp.verifyOTP(otpInput.trim(), job.otp_hash);

  if (!isValid) {
    await wa.sendText(phone,
      `❌ *Invalid OTP!* Please ask the customer to check and share again.\n\nYou have 3 attempts.`
    );
    return;
  }

  // Update job status
  await db.query(
    `UPDATE jobs SET status = 'in_progress', started_at = now(), otp_verified = true, updated_at = now()
     WHERE id = $1`,
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
    `📸 1. Before/during work\n` +
    `📸 2. Completed installation/repair\n\n` +
    `_(Required for payment release)_`
  );
}

/**
 * Handle completion photos from technician
 */
async function handleCompletionPhoto(phone, mediaUrl, ctx) {
  const photos = [...(ctx.photos || []), mediaUrl];

  if (photos.length < 2) {
    await session.updateContext(phone, { photos });
    await wa.sendText(phone,
      `📸 Photo ${photos.length}/2 received. Send ${2 - photos.length} more photo(s) to complete.`
    );
    return;
  }

  // Job done - mark pending verification
  await db.query(
    `UPDATE jobs SET status = 'pending_verification', proof_photos = $1, updated_at = now()
     WHERE id = $2`,
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
    `💰 Payment will be released after customer confirms.\n` +
    `_(Auto-released in 4 hours if no response)_`
  );

  // Notify customer for verification
  await wa.sendButtons(job.customer_phone,
    `🔧 *Work Completed on ${job.unit_code}!*\n\n` +
    `Your technician has completed the ${job.type} and submitted photos.\n\n` +
    `Was the work done satisfactorily?`,
    [
      { id: `VERIFY_YES_${ctx.job_id}`, title: '✅ Yes, All Good!' },
      { id: `VERIFY_NO_${ctx.job_id}`, title: '❌ No, Issue Remains' },
    ]
  );
}

/**
 * Handle admin approve/reject technician
 */
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
      `🎉 *Congratulations ${tech.name}!*\n\n` +
      `Your Knite technician account is now *ACTIVE*! ✅\n\n` +
      `You'll start receiving job notifications in your zone.\n\n` +
      `💡 Tips:\n` +
      `• Accept jobs quickly - first accepted wins!\n` +
      `• Maintain high ratings for priority job access\n` +
      `• Typical earnings: ₹700-1,600/day\n\n` +
      `Welcome to the team! 🔧`
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
  handleZone,
  handleKYC,
  handleJobAccept,
  handleJobDecline,
  handleArrived,
  handleOTPVerification,
  handleCompletionPhoto,
  handleAdminApproval,
};
