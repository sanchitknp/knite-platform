/**
 * Main Webhook Controller
 * Routes all incoming WhatsApp messages to appropriate flow handlers.
 *
 * ─────────────────────────────────────────────
 * Two-number routing
 * ─────────────────────────────────────────────
 * Knite runs on two WhatsApp Business numbers:
 *   - TECH    line → technician onboarding + job lifecycle
 *   - SERVICE line → customer installation + repair/support
 *
 * The 6th argument `line` is propagated from server.js (extracted from the
 * incoming webhook's metadata.phone_number_id) and tells us which of our
 * two numbers received the message. We gate intents accordingly:
 *
 *   - Customer intents (Install, Support) on TECH line  → cross-line redirect
 *   - Technician intents (REGISTER TECH, job actions) on SERVICE line
 *       → cross-line redirect (with the exception of CTA button `TECH_JOIN`
 *         on the service menu, which deep-links out to the tech number)
 *
 * Cross-line redirects send the user a wa.me link to the correct number
 * so they can continue the conversation there.
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

// Customer intents — allowed only on SERVICE line
const CUSTOMER_INTENTS_RE = /^(SCAN_HELP|SUPPORT_HELP|TRANSFER|INSTALL[_\s])/i;
// Technician intents — allowed only on TECH line
const TECH_INTENTS_RE = /^(REGISTER\s+TECH|TECH_JOIN|TECH_PENDING_JOBS|JOB_DETAIL[_\s]|ACCEPT[_\s]|DECLINE[_\s]|ARRIVED[_\s]|APPROVE_TECH[_\s]|REJECT_TECH[_\s]|REFER$|REFER_TECH$|JOIN$|TECH$)/i;

/**
 * Send a "wrong number" redirect to the correct line.
 */
async function redirectToLine(phone, fromLine, toLine, reason) {
  const toPhone = wa.waMePhoneFor(toLine);
  const toDisplay = wa.displayPhoneFor(toLine);
  const verb = toLine === 'tech'
    ? 'For technician support (join, job status, payments)'
    : 'For installations, repairs and support';
  const body =
    `👋 You reached the wrong number for this request.\n\n` +
    `${verb}, please message us at *${toDisplay}*:\n` +
    `https://wa.me/${toPhone}${reason ? `?text=${encodeURIComponent(reason)}` : ''}\n\n` +
    `_(This number handles a different set of requests.)_`;
  await wa.sendText(phone, body, { line: fromLine });
}

/**
 * Main message handler - routes to appropriate flow
 *
 * @param {string} phone       - WhatsApp phone number of the sender
 * @param {string} text        - Text / button-id content
 * @param {string|null} mediaUrl
 * @param {object|null} flowData - nfm_reply JSON when a WhatsApp Flow completes
 * @param {object|null} location - location pin payload
 * @param {'tech'|'service'|'unknown'} [line='service'] - which of our two
 *        business numbers received this message. Defaults to 'service' so
 *        simulator calls + any pre-two-number callers keep working.
 */
async function handleMessage(phone, text, mediaUrl = null, flowData = null, location = null, line = 'service') {
  const trimmed = text ? text.trim() : '';
  const upper = trimmed.toUpperCase();

  // Unknown line (message came in on a phone number we don't recognise) —
  // treat as service for safety, but log so we notice if Meta ever adds
  // a third number under our account.
  if (line === 'unknown') {
    console.warn(`[WEBHOOK] Unknown line for phone=${phone}; falling back to service`);
    line = 'service';
  }

  // ─── Look up session ───
  const sess = await session.getSession(phone);
  const flow = sess?.flow;
  const step = sess?.step;
  const ctx = sess?.context_data || {};

  // ─── Check for technician identity ───
  const techResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [phone]);
  const isTech = techResult.rows.length > 0;

  // ─── Handle job-related commands (these are TECH-line intents) ───
  // Gate: all job action IDs must arrive on the tech line. If they arrive
  // on the service line, redirect.
  const techActionRe = /^(ACCEPT|DECLINE|ARRIVED|APPROVE_TECH|REJECT_TECH|TRANSFER_APPROVE|TRANSFER_DENY)[_\s]/i;
  if (techActionRe.test(trimmed) && line !== 'tech') {
    await redirectToLine(phone, line, 'tech', trimmed);
    return;
  }

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

  // VERIFY_YES / VERIFY_NO (customer verification) — SERVICE line only
  const verifyYesMatch = trimmed.match(/VERIFY_YES[_\s]([a-f0-9-]{36})/i);
  if (verifyYesMatch) {
    if (line !== 'service') { await redirectToLine(phone, line, 'service', trimmed); return; }
    await handleJobVerification(phone, verifyYesMatch[1], true);
    return;
  }
  const verifyNoMatch = trimmed.match(/VERIFY_NO[_\s]([a-f0-9-]{36})/i);
  if (verifyNoMatch) {
    if (line !== 'service') { await redirectToLine(phone, line, 'service', trimmed); return; }
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

  // Ownership transfer decisions — SERVICE line (customers own units)
  const transferApproveMatch = trimmed.match(/TRANSFER_APPROVE[_\s]([a-f0-9-]{36})[_\s](\d+)/i);
  if (transferApproveMatch) {
    if (line !== 'service') { await redirectToLine(phone, line, 'service', trimmed); return; }
    await ownershipFlow.handleTransferApprove(phone, transferApproveMatch[1], transferApproveMatch[2]);
    return;
  }
  const transferDenyMatch = trimmed.match(/TRANSFER_DENY[_\s]([a-f0-9-]{36})[_\s](\d+)/i);
  if (transferDenyMatch) {
    if (line !== 'service') { await redirectToLine(phone, line, 'service', trimmed); return; }
    await ownershipFlow.handleTransferDeny(phone, transferDenyMatch[1], transferDenyMatch[2]);
    return;
  }

  // ─── Reset keywords always show main menu, even mid-flow ───
  if (upper === 'HELP' || upper === 'HI' || upper === 'HELLO' || upper === 'MENU' || upper === 'MAIN_MENU') {
    await session.clearSession(phone);
    await sendMainMenu(phone, isTech, line);
    return;
  }

  // ─── Tech registration — TECH line only ───
  if (upper.includes('REGISTER TECH') || upper === 'TECH' || upper === 'JOIN' || upper === 'TECH_JOIN') {
    if (line !== 'tech') {
      await redirectToLine(phone, line, 'tech', 'JOIN');
      return;
    }
    const refMatch = trimmed.match(/REF[_\s]([A-Z0-9]{6,10})/i);
    await techFlow.startOnboarding(phone, refMatch ? refMatch[1].toUpperCase() : null);
    return;
  }

  // ─── Continue active session flow ───
  // Sessions are created on a specific line; continuing them is allowed on
  // the same line. If a user somehow lands on the other line mid-session
  // (e.g. typing unrelated text), we'd drop through to the line-gated
  // intents below and show them a menu/redirect. To avoid confusion, we
  // also record the line in the session (see setSession callers) and
  // require it match when resuming — but for now we just forward.
  if (flow && step) {
    await continueFlow(phone, flow, step, ctx, trimmed, upper, mediaUrl, isTech, flowData, location, line);
    return;
  }

  // ─── Intent detection for new flows ───

  // Install command: "Install KN-XXXX" or just "KN-XXXX" — SERVICE line only
  const installMatch = trimmed.match(/^(?:install\s+)?(KN-\w+)$/i);
  if (installMatch) {
    if (line !== 'service') {
      await redirectToLine(phone, line, 'service', `Install ${installMatch[1].toUpperCase()}`);
      return;
    }
    await installFlow.start(phone, installMatch[1].toUpperCase());
    return;
  }

  // Technician referral — TECH line only (this is a technician activity)
  if (upper === 'REFER' || upper === 'REFER_TECH') {
    if (line !== 'tech') {
      await redirectToLine(phone, line, 'tech', 'REFER');
      return;
    }
    await referralFlow.handleRefer(phone);
    return;
  }

  // Technician: pending installations — TECH line only
  if (upper === 'TECH_PENDING_JOBS') {
    if (line !== 'tech') {
      await redirectToLine(phone, line, 'tech', 'TECH_PENDING_JOBS');
      return;
    }
    await handleTechPendingJobs(phone);
    return;
  }

  // Technician: view job detail — TECH line only
  const jobDetailMatch = trimmed.match(/^JOB_DETAIL[_\s]([a-f0-9-]{36})$/i);
  if (jobDetailMatch) {
    if (line !== 'tech') {
      await redirectToLine(phone, line, 'tech', trimmed);
      return;
    }
    await handleTechJobDetail(phone, jobDetailMatch[1]);
    return;
  }

  // Service-line CTA: "Join as Technician" button on the customer menu
  // deep-links out to the tech number instead of handling join inline here.
  if (upper === 'JOIN_TECH_REDIRECT') {
    await redirectToLine(phone, line, 'tech', 'JOIN');
    return;
  }

  // Main menu button: New Installation — SERVICE line
  if (upper === 'SCAN_HELP') {
    if (line !== 'service') {
      await redirectToLine(phone, line, 'service', 'SCAN_HELP');
      return;
    }
    await wa.sendText(phone, `📦 *New Installation*\n\nPlease type: *Install <unit-code>*\n\n_Example: Install KN-8492_\n\n_The unit code is printed on the QR sticker on your RO purifier._`, { line: 'service' });
    return;
  }

  // Main menu button: Support / Repair — SERVICE line
  if (upper === 'SUPPORT_HELP') {
    if (line !== 'service') {
      await redirectToLine(phone, line, 'service', 'SUPPORT_HELP');
      return;
    }
    const custResult = await db.query(
      `INSERT INTO customers (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET updated_at = now() RETURNING *`,
      [phone]
    );
    await supportFlow.start(phone, custResult.rows[0]);
    return;
  }

  // Transfer request — SERVICE line (customer ownership action)
  if (upper === 'TRANSFER') {
    if (line !== 'service') {
      await redirectToLine(phone, line, 'service', 'TRANSFER');
      return;
    }
    if (ctx.unit_id) {
      await ownershipFlow.handleTransferRequest(phone, ctx);
    } else {
      await wa.sendText(phone, `Please scan the QR code on your unit first, then type TRANSFER.`, { line: 'service' });
    }
    return;
  }

  // Support keywords — SERVICE line
  if (supportFlow.isSupport(trimmed)) {
    if (line !== 'service') {
      await redirectToLine(phone, line, 'service', trimmed);
      return;
    }
    const custResult = await db.query(
      `INSERT INTO customers (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET updated_at = now() RETURNING *`,
      [phone]
    );
    await supportFlow.start(phone, custResult.rows[0]);
    return;
  }

  // Default → main menu (line-specific)
  await sendMainMenu(phone, isTech, line);
}

/**
 * Continue an active flow session
 */
async function continueFlow(phone, flow, step, ctx, text, upper, mediaUrl, isTech, flowData = null, location = null, line = 'service') {
  // ── INSTALLATION FLOW ── (SERVICE line)
  if (flow === 'installation') {
    if (step === 'awaiting_flow') {
      // WhatsApp Flow completion response
      if (flowData) {
        await installFlow.handleInstallFlowResponse(phone, flowData, ctx);
      } else {
        // User sent text while waiting for flow — re-send
        await wa.sendText(phone, `Please complete the address form to continue. 👇`, { line: 'service' });
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
          `📌 Tap the button below to share your location, or type *SKIP* to continue without sharing.`,
          { line: 'service' }
        );
      }
    } else if (step === 'awaiting_slot') {
      await installFlow.handleSlot(phone, text, ctx);
    }
    return;
  }

  // ── SUPPORT FLOW ── (SERVICE line)
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
        await wa.sendText(phone, `✅ Payment of ₹500 noted. Choose a slot:`, { line: 'service' });
        await wa.sendButtons(phone, `📅 Select repair slot:`, buttons, { line: 'service' });
      } else {
        await session.clearSession(phone);
        await wa.sendText(phone, `👍 Repair cancelled. Type 'help' anytime if you need assistance.`, { line: 'service' });
      }
    }
    return;
  }

  // ── MAINTENANCE FLOW ── (SERVICE line)
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
        await wa.sendText(phone, `👍 Cancelled. We'll remind you later.`, { line: 'service' });
      }
    } else if (step === 'awaiting_slot') {
      await maintenanceFlow.handleSlot(phone, text, ctx);
    }
    return;
  }

  // ── TECH ONBOARDING FLOW ── (TECH line)
  if (flow === 'tech_onboarding') {
    if (step === 'awaiting_name') {
      await techFlow.handleName(phone, text, ctx);
    } else if (step === 'awaiting_flow') {
      // WhatsApp Flow completion response
      if (flowData) {
        await techFlow.handleFlowResponse(phone, flowData, ctx);
      } else {
        // User sent a text message while waiting for flow — re-send the flow
        await wa.sendText(phone, `Please complete the form to continue. 👇`, { line: 'tech' });
        await techFlow.sendAreaSelectionFlow(phone);
      }
    } else if (step === 'awaiting_more_states') {
      await techFlow.handleMoreStates(phone, text, ctx);
    } else if (step === 'awaiting_kyc_front' || step === 'awaiting_kyc') {
      // awaiting_kyc kept for backwards compat with any in-flight sessions
      // from before the front/back split.
      await techFlow.handleKYCFront(phone, mediaUrl, ctx);
    } else if (step === 'awaiting_kyc_back') {
      await techFlow.handleKYCBack(phone, mediaUrl, ctx);
    }
    return;
  }

  // ── TECH JOB FLOW ── (TECH line)
  if (flow === 'tech_job') {
    if (step === 'awaiting_otp') {
      if (/^\d{6}$/.test(text.trim())) {
        await techFlow.handleOTPVerification(phone, text.trim(), ctx);
      } else {
        await wa.sendText(phone, `Please enter the 6-digit *Happiness Code* from the customer:`, { line: 'tech' });
      }
    } else if (step === 'awaiting_completion_photos') {
      if (mediaUrl) {
        await techFlow.handleCompletionPhoto(phone, mediaUrl, ctx);
      } else {
        await wa.sendText(phone, `Please send a *photo* of the completed work (${(ctx.photos || []).length + 1}/2):`, { line: 'tech' });
      }
    }
    return;
  }

  // ── OWNERSHIP TRANSFER FLOW ── (SERVICE line)
  if (flow === 'ownership_transfer') {
    if (step === 'awaiting_transfer_request' && upper === 'TRANSFER') {
      await ownershipFlow.handleTransferRequest(phone, ctx);
    }
    return;
  }
}

/**
 * Handle customer job verification (runs on SERVICE line)
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

    // Customer is on SERVICE line; technician notification goes on TECH line
    await wa.sendText(phone, `✅ *Thank you for confirming!* We hope you're satisfied with the service.\n\n⭐ How would you rate the technician? (Reply 1-5)`, { line: 'service' });
    await wa.sendText(job.tech_phone,
      `✅ *Job Verified & Completed!*\n\n` +
      `💰 Payout: ₹${Math.round(job.payout_paise / 100)} will be settled this week.\n\n` +
      `Great job! 🎉`,
      { line: 'tech' }
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
      ],
      { line: 'service' }
    );

    await wa.sendText(job.tech_phone,
      `⚠️ *Customer raised a dispute on Job ${jobId}.*\n\n` +
      `Payout is temporarily frozen. Admin will review and contact you.`,
      { line: 'tech' }
    );

    // Alert admin (admin is on the TECH line — admins manage the tech side)
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
        ],
        { line: 'tech' }
      );
    }
  }
}

/**
 * Show pending jobs (TECH line)
 */
async function handleTechPendingJobs(phone) {
  const techResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [phone]);
  const tech = techResult.rows[0];
  if (!tech) {
    await wa.sendText(phone, `❌ You are not registered as a technician.`, { line: 'tech' });
    return;
  }

  const jobsResult = await db.query(
    `SELECT j.id, j.type, j.status, j.scheduled_start, j.payout_paise,
            u.unit_id as unit_code, u.install_address
     FROM jobs j
     JOIN units u ON u.id = j.unit_id
     WHERE j.technician_id = $1
       AND j.status IN ('assigned', 'en_route', 'arrived', 'in_progress', 'pending_verification')
     ORDER BY j.scheduled_start ASC NULLS LAST`,
    [tech.id]
  );

  const jobs = jobsResult.rows;

  if (jobs.length === 0) {
    await wa.sendText(phone, `✅ You have no pending installations right now.\n\nNew jobs will be sent to you automatically.`, { line: 'tech' });
    return;
  }

  const flowId = process.env.WA_FLOW_PENDING_JOBS;

  // ── Production with flow configured: open WhatsApp Flow ──────────────────
  if (flowId && process.env.WHATSAPP_MODE === 'production') {
    await wa.sendFlow(
      phone,
      `You have ${jobs.length} pending job${jobs.length !== 1 ? 's' : ''}. Open to view details, mark arrived, enter Happiness Code, and more — all inside the form.`,
      flowId,
      phone,
      'View Jobs',
      'PENDING_JOBS',
      null,
      true,
      { line: 'tech' }
    );
    return;
  }

  // ── Fallback: button list (simulator or no flow ID) ───────────────────────
  const typeIcon  = { install: '🔧', repair: '🛠️', maintenance: '🔄' };
  const typeLabel = { install: 'Installation', repair: 'Repair', maintenance: 'Maintenance' };
  const statusShort = { assigned: '📋 Assigned', en_route: '🚗 En Route', arrived: '📍 Arrived', in_progress: '🔧 In Progress', pending_verification: '⏳ Awaiting Verify' };

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
    buttons,
    { line: 'tech' }
  );
}

/**
 * Show full details of a specific job as a chat message (TECH line)
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
    await wa.sendText(phone, `❌ Job not found.`, { line: 'tech' });
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
  if (j.status === 'assigned') {
    actionButtons.unshift({ id: `ARRIVED_${jobId}`, title: '📍 Mark Arrived' });
  } else if (j.status === 'arrived' || j.status === 'en_route') {
    actionButtons.unshift({ id: `ARRIVED_${jobId}`, title: '🔐 Enter OTP' });
  }

  await wa.sendButtons(phone, details, actionButtons, { line: 'tech' });

  // Send location pin if customer shared GPS
  if (address.location?.latitude && address.location?.longitude) {
    await wa.sendLocation(phone, address.location.latitude, address.location.longitude,
      address.raw || 'Installation Location', address.full_address || '', { line: 'tech' });
  }
}

/**
 * Send main menu — line-specific.
 *
 * TECH line:
 *   - Registered tech → technician portal (jobs, stats, referrals)
 *   - Unknown caller  → "Join as Technician" as the primary CTA
 *
 * SERVICE line:
 *   - Customer menu (install + support only). Technician join is NOT
 *     offered here — callers on the service line must go to the tech
 *     number separately.
 */
async function sendMainMenu(phone, isTech, line = 'service') {
  if (line === 'tech') {
    if (isTech) {
      // Registered technician on the tech line → full portal.
      // Exactly 3 buttons so WhatsApp renders them as native reply buttons
      // (4+ buttons collapse into a "Choose an option" list dropdown that
      // hides the actions until the user taps it).
      await wa.sendButtons(phone,
        `👋 *Knite Technician Portal*\n\nYou'll receive job notifications automatically.\n\nWhat do you need?`,
        [
          { id: 'TECH_PENDING_JOBS', title: '🔧 Pending Jobs' },
          { id: 'REFER_TECH', title: '🤝 Refer & Earn' },
          { id: 'HELP', title: '❓ Help' },
        ],
        { line: 'tech' }
      );
    } else {
      // Unknown caller on the tech line → tech-focused menu
      await wa.sendButtons(phone,
        `👋 *Knite — Technician Line*\n\nThis number is for Knite technicians.\n\n` +
        `👨‍🔧 *Looking to join as a technician?*`,
        [
          { id: 'TECH_JOIN', title: '👨‍🔧 Join as Technician' },
          { id: 'HELP', title: '❓ Help' },
        ],
        { line: 'tech' }
      );
    }
    return;
  }

  // SERVICE line → customer menu
  await wa.sendButtons(phone,
    `👋 *Welcome to Knite!*\n\nWater purifier installation & support 💧\n\nHow can I help you?`,
    [
      { id: 'SCAN_HELP', title: '📦 New Installation' },
      { id: 'SUPPORT_HELP', title: '🔧 Support / Repair' },
    ],
    { line: 'service' }
  );
}

function extractSlotKey(text) {
  if (text.includes('ASAP') || text.includes('asap')) return 'ASAP';
  if (text.includes('MORNING') || text.includes('morning') || text.includes('9')) return 'TOMORROW_MORNING';
  if (text.includes('MIDDAY') || text.includes('midday') || text.includes('12')) return 'TOMORROW_MIDDAY';
  if (text.includes('EVENING') || text.includes('evening') || text.includes('4-6') || text.includes('16')) return 'TOMORROW_EVENING';
  return 'TOMORROW_MORNING';
}

module.exports = { handleMessage };
