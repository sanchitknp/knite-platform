/**
 * Main Webhook Controller
 * Routes all incoming WhatsApp messages to appropriate flow handlers
 */
const db = require('../db');
const wa = require('../services/whatsappService');
const session = require('../services/sessionService');
const installFlow = require('../services/flows/installationFlow');
const supportFlow = require('../services/flows/supportFlow');
const techFlow = require('../services/flows/techFlow');
const maintenanceFlow = require('../services/flows/maintenanceFlow');
const ownershipFlow = require('../services/flows/ownershipFlow');
const maintenanceService = require('../services/flows/maintenanceFlow');
const referralFlow = require('../services/flows/referralFlow');

/**
 * Main message handler - routes to appropriate flow
 */
async function handleMessage(phone, text, mediaUrl = null, flowData = null, location = null) {
  const trimmed = text ? text.trim() : '';
  const upper = trimmed.toUpperCase();

  // ─── Dedup check (by message ID not needed in simulator, but phone+time) ───

  // ─── Look up session ───
  const sess = await session.getSession(phone);
  const flow = sess?.flow;
  const step = sess?.step;
  const ctx = sess?.context_data || {};

  // ─── Check for technician identity ───
  const techResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [phone]);
  const isTech = techResult.rows.length > 0;

  // ─── Handle job-related commands (any phone can send these) ───
  // ACCEPT job
  const acceptMatch = upper.match(/ACCEPT[_\s]([A-F0-9-]{36})/i) ||
    (upper.startsWith('ACCEPT_') && upper.substring(7).match(/[A-F0-9-]{36}/i));
  if (acceptMatch || (trimmed.match(/^ACCEPT_([a-f0-9-]{36})$/i))) {
    const match = trimmed.match(/ACCEPT[_\s]([a-f0-9-]{36})/i);
    if (match) {
      await techFlow.handleJobAccept(phone, match[1]);
      return;
    }
  }

  // DECLINE job
  const declineMatch = trimmed.match(/DECLINE[_\s]([a-f0-9-]{36})/i);
  if (declineMatch) {
    await techFlow.handleJobDecline(phone, declineMatch[1]);
    return;
  }

  // ARRIVED at job
  const arrivedMatch = trimmed.match(/ARRIVED[_\s]([a-f0-9-]{36})/i);
  if (arrivedMatch) {
    await techFlow.handleArrived(phone, arrivedMatch[1]);
    return;
  }

  // VERIFY_YES / VERIFY_NO (customer verification)
  const verifyYesMatch = trimmed.match(/VERIFY_YES[_\s]([a-f0-9-]{36})/i);
  if (verifyYesMatch) {
    await handleJobVerification(phone, verifyYesMatch[1], true);
    return;
  }
  const verifyNoMatch = trimmed.match(/VERIFY_NO[_\s]([a-f0-9-]{36})/i);
  if (verifyNoMatch) {
    await handleJobVerification(phone, verifyNoMatch[1], false);
    return;
  }

  // Admin: APPROVE/REJECT technician
  const approveTechMatch = trimmed.match(/APPROVE_TECH[_\s]([a-f0-9-]{36})/i);
  if (approveTechMatch) {
    await techFlow.handleAdminApproval(phone, approveTechMatch[1], true);
    return;
  }
  const rejectTechMatch = trimmed.match(/REJECT_TECH[_\s]([a-f0-9-]{36})/i);
  if (rejectTechMatch) {
    await techFlow.handleAdminApproval(phone, rejectTechMatch[1], false);
    return;
  }

  // Ownership transfer decisions
  const transferApproveMatch = trimmed.match(/TRANSFER_APPROVE[_\s]([a-f0-9-]{36})[_\s](\d+)/i);
  if (transferApproveMatch) {
    await ownershipFlow.handleTransferApprove(phone, transferApproveMatch[1], transferApproveMatch[2]);
    return;
  }
  const transferDenyMatch = trimmed.match(/TRANSFER_DENY[_\s]([a-f0-9-]{36})[_\s](\d+)/i);
  if (transferDenyMatch) {
    await ownershipFlow.handleTransferDeny(phone, transferDenyMatch[1], transferDenyMatch[2]);
    return;
  }

  // ─── Reset keywords always show main menu, even mid-flow ───
  if (upper === 'HELP' || upper === 'HI' || upper === 'HELLO' || upper === 'MENU' || upper === 'MAIN_MENU') {
    await session.clearSession(phone);
    await sendMainMenu(phone, isTech);
    return;
  }

  // ─── Tech registration — checked BEFORE session continuation so referral links
  //     like "REGISTER TECH REF_XXX" always start fresh and don't get swallowed
  //     by an existing awaiting_name session ───
  if (upper.includes('REGISTER TECH') || upper === 'TECH' || upper === 'JOIN' || upper === 'TECH_JOIN') {
    const refMatch = trimmed.match(/REF[_\s]([A-Z0-9]{6,10})/i);
    await techFlow.startOnboarding(phone, refMatch ? refMatch[1].toUpperCase() : null);
    return;
  }

  // ─── Continue active session flow ───
  if (flow && step) {
    await continueFlow(phone, flow, step, ctx, trimmed, upper, mediaUrl, isTech, flowData, location);
    return;
  }

  // ─── Intent detection for new flows ───

  // Install command: "Install KN-XXXX" or just "KN-XXXX"
  const installMatch = trimmed.match(/^(?:install\s+)?(KN-\w+)$/i);
  if (installMatch) {
    await installFlow.start(phone, installMatch[1].toUpperCase());
    return;
  }

  // Technician referral
  if (upper === 'REFER' || upper === 'REFER_TECH') {
    await referralFlow.handleRefer(phone);
    return;
  }

  // Technician: pending installations
  if (upper === 'TECH_PENDING_JOBS') {
    await handleTechPendingJobs(phone);
    return;
  }

  // Technician: view job detail
  const jobDetailMatch = trimmed.match(/^JOB_DETAIL[_\s]([a-f0-9-]{36})$/i);
  if (jobDetailMatch) {
    await handleTechJobDetail(phone, jobDetailMatch[1]);
    return;
  }

  // Main menu button: New Installation
  if (upper === 'SCAN_HELP') {
    await wa.sendText(phone, `📦 *New Installation*\n\nPlease type: *Install <unit-code>*\n\n_Example: Install KN-8492_\n\n_The unit code is printed on the QR sticker on your RO purifier._`);
    return;
  }

  // Main menu button: Support / Repair
  if (upper === 'SUPPORT_HELP') {
    const custResult = await db.query(
      `INSERT INTO customers (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET updated_at = now() RETURNING *`,
      [phone]
    );
    await supportFlow.start(phone, custResult.rows[0]);
    return;
  }

  // Transfer request
  if (upper === 'TRANSFER') {
    if (ctx.unit_id) {
      await ownershipFlow.handleTransferRequest(phone, ctx);
    } else {
      await wa.sendText(phone, `Please scan the QR code on your unit first, then type TRANSFER.`);
    }
    return;
  }

  // Support keywords
  if (supportFlow.isSupport(trimmed)) {
    const custResult = await db.query(
      `INSERT INTO customers (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET updated_at = now() RETURNING *`,
      [phone]
    );
    await supportFlow.start(phone, custResult.rows[0]);
    return;
  }

  // Help / Menu
  if (upper === 'HELP' || upper === 'HI' || upper === 'HELLO' || upper === 'MENU' || upper === 'MAIN_MENU') {
    await sendMainMenu(phone, isTech);
    return;
  }

  // Default
  await sendMainMenu(phone, isTech);
}

/**
 * Continue an active flow session
 */
async function continueFlow(phone, flow, step, ctx, text, upper, mediaUrl, isTech, flowData = null, location = null) {
  // ── INSTALLATION FLOW ──
  if (flow === 'installation') {
    if (step === 'awaiting_flow') {
      // WhatsApp Flow completion response
      if (flowData) {
        await installFlow.handleInstallFlowResponse(phone, flowData, ctx);
      } else {
        // User sent text while waiting for flow — re-send
        await wa.sendText(phone, `Please complete the address form to continue. 👇`);
        await installFlow.sendInstallAddressFlow(phone);
      }
    } else if (step === 'awaiting_location') {
      if (location) {
        // User shared their WhatsApp location
        await installFlow.handleInstallLocation(phone, location, ctx);
      } else if (upper === 'SKIP') {
        // User chose to skip location sharing
        const areaName = ctx.address ? ctx.address.split(',')[0].trim() : 'your area';
        const district = ctx.address ? ctx.address.split(',')[1]?.trim() : '';
        await session.setSession(phone, { flow: 'installation', step: 'awaiting_slot', context_data: ctx });
        await installFlow.sendSlotButtons(phone, areaName, district, ctx.address || '');
      } else {
        // Remind them with a location request button
        await wa.sendLocationRequest(phone,
          `📌 Tap the button below to share your location, or type *SKIP* to continue without sharing.`
        );
      }
    } else if (step === 'awaiting_slot') {
      await installFlow.handleSlot(phone, text, ctx);
    }
    return;
  }

  // ── SUPPORT FLOW ──
  if (flow === 'support') {
    if (step === 'awaiting_unit_selection') {
      const unitMatch = text.match(/UNIT[_\s]([a-f0-9-]{36})/i);
      if (unitMatch) {
        const unitResult = await db.query(`SELECT * FROM units WHERE id = $1`, [unitMatch[1]]);
        if (unitResult.rows[0]) {
          const custResult = await db.query(`SELECT * FROM customers WHERE phone = $1`, [phone]);
          await supportFlow.startTriage(phone, custResult.rows[0], unitResult.rows[0]);
        }
      } else {
        // Try number selection
        const units = await db.query(
          `SELECT * FROM units WHERE customer_id = (SELECT id FROM customers WHERE phone = $1) AND status NOT IN ('manufactured','shipped','deactivated')`,
          [phone]
        );
        const num = parseInt(text);
        if (!isNaN(num) && units.rows[num - 1]) {
          const custResult = await db.query(`SELECT * FROM customers WHERE phone = $1`, [phone]);
          await supportFlow.startTriage(phone, custResult.rows[0], units.rows[num - 1]);
        }
      }
    } else if (step === 'awaiting_issue_type') {
      await supportFlow.handleIssueType(phone, text, ctx);
    } else if (step === 'awaiting_media') {
      if (mediaUrl || upper.includes('SKIP')) {
        await supportFlow.handleMediaAndDispatch(phone, text, mediaUrl, ctx);
      } else {
        await supportFlow.handleMediaAndDispatch(phone, text, null, ctx);
      }
    } else if (step === 'awaiting_warranty_slot') {
      await supportFlow.dispatchRepair(phone, extractSlotKey(text), ctx);
    } else if (step === 'awaiting_oowarranty_confirm') {
      if (upper.includes('PAY') || upper.includes('SCHEDULE')) {
        // Simulate payment
        await session.setSession(phone, {
          flow: 'support',
          step: 'awaiting_warranty_slot',
          context_data: ctx
        });
        const hour = new Date().getHours();
        const buttons = [];
        if (hour < 16) buttons.push({ id: 'ASAP', title: '⚡ ASAP' });
        buttons.push(
          { id: 'TOMORROW_MORNING', title: '🌅 Tomorrow 9-11 AM' },
          { id: 'TOMORROW_MIDDAY', title: '☀️ Tomorrow 12-2 PM' },
          { id: 'TOMORROW_EVENING', title: '🌆 Tomorrow 4-6 PM' }
        );
        await wa.sendText(phone, `✅ Payment of ₹500 noted. Choose a slot:`);
        await wa.sendButtons(phone, `📅 Select repair slot:`, buttons);
      } else {
        await session.clearSession(phone);
        await wa.sendText(phone, `👍 Repair cancelled. Type 'help' anytime if you need assistance.`);
      }
    }
    return;
  }

  // ── MAINTENANCE FLOW ──
  if (flow === 'maintenance') {
    if (step === 'awaiting_confirm') {
      if (upper.includes('MAINTENANCE_YES') || upper.includes('YES')) {
        await maintenanceFlow.handleConfirm(phone, ctx);
      } else if (upper.includes('MAINTENANCE_NO') || upper.includes('NO') || upper.includes('LATER')) {
        await maintenanceFlow.handleSnooze(phone, ctx);
      }
    } else if (step === 'awaiting_payment') {
      if (upper.includes('PAYMENT_DONE') || upper.includes('DONE') || upper.includes('PAID')) {
        await maintenanceFlow.handlePaymentConfirmed(phone, ctx);
      } else if (upper.includes('CANCEL')) {
        await session.clearSession(phone);
        await wa.sendText(phone, `👍 Cancelled. We'll remind you later.`);
      }
    } else if (step === 'awaiting_slot') {
      await maintenanceFlow.handleSlot(phone, text, ctx);
    }
    return;
  }

  // ── TECH ONBOARDING FLOW ──
  if (flow === 'tech_onboarding') {
    if (step === 'awaiting_name') {
      await techFlow.handleName(phone, text, ctx);
    } else if (step === 'awaiting_flow') {
      // WhatsApp Flow completion response
      if (flowData) {
        await techFlow.handleFlowResponse(phone, flowData, ctx);
      } else {
        // User sent a text message while waiting for flow — re-send the flow
        await wa.sendText(phone, `Please complete the form to continue. 👇`);
        await techFlow.sendAreaSelectionFlow(phone);
      }
    } else if (step === 'awaiting_more_states') {
      await techFlow.handleMoreStates(phone, text, ctx);
    } else if (step === 'awaiting_kyc') {
      await techFlow.handleKYC(phone, mediaUrl, ctx);
    }
    return;
  }

  // ── TECH JOB FLOW ──
  if (flow === 'tech_job') {
    if (step === 'awaiting_otp') {
      if (/^\d{6}$/.test(text.trim())) {
        await techFlow.handleOTPVerification(phone, text.trim(), ctx);
      } else {
        await wa.sendText(phone, `Please enter the 6-digit *Happiness Code* from the customer:`);
      }
    } else if (step === 'awaiting_completion_photos') {
      if (mediaUrl) {
        await techFlow.handleCompletionPhoto(phone, mediaUrl, ctx);
      } else {
        await wa.sendText(phone, `Please send a *photo* of the completed work (${(ctx.photos || []).length + 1}/2):`);
      }
    }
    return;
  }

  // ── OWNERSHIP TRANSFER FLOW ──
  if (flow === 'ownership_transfer') {
    if (step === 'awaiting_transfer_request' && upper === 'TRANSFER') {
      await ownershipFlow.handleTransferRequest(phone, ctx);
    }
    return;
  }
}

/**
 * Handle customer job verification
 */
async function handleJobVerification(phone, jobId, approved) {
  const jobResult = await db.query(
    `SELECT j.*, t.phone as tech_phone, t.name as tech_name, u.unit_id as unit_code, u.id as unit_uuid
     FROM jobs j
     JOIN technicians t ON t.id = j.technician_id
     JOIN units u ON u.id = j.unit_id
     WHERE j.id = $1`,
    [jobId]
  );
  const job = jobResult.rows[0];
  if (!job) return;

  if (approved) {
    // Complete job and pay technician
    await db.query(
      `UPDATE jobs SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = $1`,
      [jobId]
    );

    // Determine new unit status
    const newUnitStatus = job.type === 'install' ? 'active' : 'active';
    await db.query(
      `UPDATE units SET status = $1, updated_at = now() WHERE id = $2`,
      [newUnitStatus, job.unit_uuid]
    );

    // If installation, set install date, warranty, and create maintenance schedule
    if (job.type === 'install') {
      const warrantyExpires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      await db.query(
        `UPDATE units SET install_date = now(), warranty_expires_at = $1, updated_at = now() WHERE id = $2`,
        [warrantyExpires, job.unit_uuid]
      );
      await maintenanceService.createInitialSchedule(job.unit_uuid, job.customer_id);
    }

    // If maintenance, create next schedule
    if (job.type === 'maintenance') {
      const unitResult = await db.query(`SELECT maintenance_cycle FROM units WHERE id = $1`, [job.unit_uuid]);
      await maintenanceService.createNextSchedule(
        job.unit_uuid, job.customer_id,
        unitResult.rows[0]?.maintenance_cycle || 0
      );
    }

    // Create ledger entry for tech payout
    await db.query(
      `INSERT INTO ledger_entries (job_id, technician_id, type, amount_paise)
       VALUES ($1, $2, 'tech_payout', $3)`,
      [jobId, job.technician_id, job.payout_paise]
    );

    // Update tech stats
    await db.query(
      `UPDATE technicians SET jobs_completed = jobs_completed + 1, updated_at = now() WHERE id = $1`,
      [job.technician_id]
    );

    // Trigger referral reward check (non-blocking)
    referralFlow.onJobCompleted(job.technician_id).catch(err =>
      console.error('[REFERRAL] onJobCompleted error:', err.message)
    );

    await db.query(
      `SELECT log_job_event($1, 'verified_complete', 'pending_verification', 'completed', 'customer', $2, '{}')`,
      [jobId, job.customer_id]
    );

    await wa.sendText(phone, `✅ *Thank you for confirming!* We hope you're satisfied with the service.\n\n⭐ How would you rate the technician? (Reply 1-5)`);
    await wa.sendText(job.tech_phone,
      `✅ *Job Verified & Completed!*\n\n` +
      `💰 Payout: ₹${Math.round(job.payout_paise / 100)} will be settled this week.\n\n` +
      `Great job! 🎉`
    );
  } else {
    // Dispute
    await db.query(
      `UPDATE jobs SET status = 'disputed', updated_at = now() WHERE id = $1`,
      [jobId]
    );
    await db.query(
      `UPDATE technicians SET dispute_count = dispute_count + 1 WHERE id = $1`,
      [job.technician_id]
    );

    // Check auto-deactivate rule (3 disputes in 30 days)
    const disputeCheck = await db.query(
      `SELECT COUNT(*) as cnt FROM jobs
       WHERE technician_id = $1 AND status = 'disputed'
         AND completed_at >= now() - INTERVAL '30 days'`,
      [job.technician_id]
    );
    if (parseInt(disputeCheck.rows[0].cnt) >= 3) {
      await db.query(`UPDATE technicians SET is_active = false WHERE id = $1`, [job.technician_id]);
      console.log(`[AUTO-DEACTIVATE] Tech ${job.technician_id} deactivated due to 3 disputes`);
    }

    await wa.sendButtons(phone,
      `❌ *What went wrong?*`,
      [
        { id: 'DISPUTE_NOSHOW', title: "Tech didn't come" },
        { id: 'DISPUTE_INCOMPLETE', title: 'Work not finished' },
        { id: 'DISPUTE_DAMAGE', title: 'Unit damaged' },
        { id: 'DISPUTE_RUDE', title: 'Rude behavior' },
        { id: 'DISPUTE_OTHER', title: 'Other' },
      ]
    );

    await wa.sendText(job.tech_phone,
      `⚠️ *Customer raised a dispute on Job ${jobId}.*\n\n` +
      `Payout is temporarily frozen. Admin will review and contact you.`
    );

    // Alert admin
    const adminResult = await db.query(`SELECT phone FROM customers WHERE phone = '919999999999'`);
    if (adminResult.rows[0]) {
      await wa.sendButtons(adminResult.rows[0].phone,
        `🚨 *Job Dispute Alert*\n\n` +
        `Job: ${jobId}\n` +
        `Unit: ${job.unit_code}\n` +
        `Tech: ${job.tech_name} (${job.tech_phone})\n` +
        `Customer: ${phone}\n` +
        `Photos: ${JSON.stringify(job.proof_photos || [])}`,
        [
          { id: `ADMIN_PAY_TECH_${jobId}`, title: '✅ Pay Tech (Work Done)' },
          { id: `ADMIN_SIDE_CUSTOMER_${jobId}`, title: '❌ Side with Customer' },
        ]
      );
    }
  }
}

/**
 * Show pending jobs.
 * In production with WA_FLOW_PENDING_JOBS set: opens a WhatsApp Flow where
 * the technician can browse jobs and tap to view full details inside the flow.
 * Otherwise: falls back to a button list (simulator / no flow ID configured).
 */
async function handleTechPendingJobs(phone) {
  const techResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [phone]);
  const tech = techResult.rows[0];
  if (!tech) {
    await wa.sendText(phone, `❌ You are not registered as a technician.`);
    return;
  }

  const jobsResult = await db.query(
    `SELECT j.id, j.type, j.status, j.scheduled_start, j.payout_paise,
            u.unit_id as unit_code, u.install_address
     FROM jobs j
     JOIN units u ON u.id = j.unit_id
     WHERE j.technician_id = $1
       AND j.status IN ('assigned', 'en_route', 'arrived', 'pending_verification')
     ORDER BY j.scheduled_start ASC NULLS LAST`,
    [tech.id]
  );

  const jobs = jobsResult.rows;

  if (jobs.length === 0) {
    await wa.sendText(phone, `✅ You have no pending installations right now.\n\nNew jobs will be sent to you automatically.`);
    return;
  }

  const flowId = process.env.WA_FLOW_PENDING_JOBS;

  // ── Production with flow configured: open WhatsApp Flow ──────────────────
  if (flowId && process.env.WHATSAPP_MODE === 'production') {
    await wa.sendFlow(
      phone,
      `You have ${jobs.length} pending installation${jobs.length !== 1 ? 's' : ''}. Open to select a job and view its details.`,
      flowId,
      phone,          // flow_token = tech phone — exchange endpoint uses this to load jobs
      'View Jobs',
      'PENDING_JOBS', // ignored for data_exchange, but kept for clarity
      null,
      true            // useDataExchange — triggers INIT call to exchange endpoint
    );
    return;
  }

  // ── Fallback: button list (simulator or no flow ID) ───────────────────────
  const typeIcon  = { install: '🔧', repair: '🛠️', maintenance: '🔄' };
  const typeLabel = { install: 'Installation', repair: 'Repair', maintenance: 'Maintenance' };
  const statusShort = { assigned: '📋 Assigned', en_route: '🚗 En Route', arrived: '📍 Arrived', pending_verification: '⏳ Pending OTP' };

  const summary = jobs.map((j, i) => {
    const address = j.install_address || {};
    const pincode = address.pincode || '';
    const slot = j.scheduled_start
      ? new Date(j.scheduled_start).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'ASAP';
    return (
      `*${i + 1}. ${typeIcon[j.type] || '🔧'} ${typeLabel[j.type] || j.type} — ${j.unit_code}*\n` +
      `   📍 Pincode: ${pincode || 'N/A'}\n` +
      `   🕐 ${slot}\n` +
      `   💰 ₹${Math.round(j.payout_paise / 100)}  ·  ${statusShort[j.status] || j.status}`
    );
  }).join('\n\n');

  const buttons = jobs.map(j => ({
    id: `JOB_DETAIL_${j.id}`,
    title: `${typeIcon[j.type] || '🔧'} ${j.unit_code}`.substring(0, 24),
  }));

  await wa.sendButtons(phone,
    `🔧 *Pending Jobs (${jobs.length})*\n\n${summary}\n\n_Tap a job below for full details & actions:_`,
    buttons
  );
}

/**
 * Show full details of a specific job as a chat message
 */
async function handleTechJobDetail(phone, jobId) {
  const jobResult = await db.query(
    `SELECT j.*, u.unit_id as unit_code, u.install_address,
            c.phone as customer_phone, c.name as customer_name
     FROM jobs j
     JOIN units u ON u.id = j.unit_id
     JOIN customers c ON c.id = j.customer_id
     WHERE j.id = $1`,
    [jobId]
  );
  const j = jobResult.rows[0];
  if (!j) {
    await wa.sendText(phone, `❌ Job not found.`);
    return;
  }

  const address = j.install_address || {};
  const typeLabel = { install: '🔧 Installation', repair: '🛠️ Repair', maintenance: '🔄 Maintenance' };
  const slot = j.scheduled_start
    ? new Date(j.scheduled_start).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
        year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : 'ASAP';

  const details =
    `*${typeLabel[j.type] || j.type} — ${j.unit_code}*\n\n` +
    `📦 *Unit:* ${j.unit_code}\n` +
    `🏠 *Address:* ${address.raw || 'Not set'}\n` +
    (address.full_address ? `   ${address.full_address}\n` : '') +
    `👤 *Customer:* ${j.customer_name || j.customer_phone}\n` +
    `📞 *Phone:* ${j.customer_phone}\n` +
    `🕐 *Slot:* ${slot}\n` +
    `💰 *Payout:* ₹${Math.round(j.payout_paise / 100)}`;

  const actionButtons = [{ id: 'TECH_PENDING_JOBS', title: '◀️ Back to List' }];
  if (j.status === 'assigned') actionButtons.unshift({ id: `ARRIVED_${jobId}`, title: '📍 Mark Arrived' });

  await wa.sendButtons(phone, details, actionButtons);

  // Send location pin if customer shared GPS
  if (address.location?.latitude && address.location?.longitude) {
    await wa.sendLocation(phone, address.location.latitude, address.location.longitude,
      address.raw || 'Installation Location', address.full_address || '');
  }
}

/**
 * Send main menu
 */
async function sendMainMenu(phone, isTech) {
  if (isTech) {
    await wa.sendButtons(phone,
      `👋 *Knite Technician Portal*\n\nYou'll receive job notifications automatically.\n\nWhat do you need?`,
      [
        { id: 'TECH_STATUS', title: '📊 My Stats' },
        { id: 'TECH_PENDING_JOBS', title: '🔧 Pending Installations' },
        { id: 'REFER_TECH', title: '🤝 Refer a Technician' },
        { id: 'HELP', title: '❓ Help' },
      ]
    );
  } else {
    await wa.sendButtons(phone,
      `👋 *Welcome to Knite!*\n\nWater purifier installation & support 💧\n\nHow can I help you?`,
      [
        { id: 'SCAN_HELP', title: '📦 New Installation' },
        { id: 'SUPPORT_HELP', title: '🔧 Support / Repair' },
        { id: 'TECH_JOIN', title: '👨‍🔧 Join as Technician' },
        { id: 'REFER_TECH', title: '🤝 Refer a Technician' },
      ]
    );
  }
}

function extractSlotKey(text) {
  if (text.includes('ASAP') || text.includes('asap')) return 'ASAP';
  if (text.includes('MORNING') || text.includes('morning') || text.includes('9')) return 'TOMORROW_MORNING';
  if (text.includes('MIDDAY') || text.includes('midday') || text.includes('12')) return 'TOMORROW_MIDDAY';
  if (text.includes('EVENING') || text.includes('evening') || text.includes('4-6') || text.includes('16')) return 'TOMORROW_EVENING';
  return 'TOMORROW_MORNING';
}

module.exports = { handleMessage };
