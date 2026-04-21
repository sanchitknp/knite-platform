/**
 * Flow 4: Technician Onboarding + Daily Operations
 *
 * Onboarding steps:
 *   awaiting_name → awaiting_state → awaiting_areas
 *     → awaiting_more_states (loop back to awaiting_state for more states)
 *     → awaiting_kyc_front → awaiting_kyc_back
 *
 * Context shape during onboarding:
 *   {
 *     name,
 *     all_state_selections: [{ state, selected_areas }],
 *     state,          // current state being configured
 *     selected_areas  // for current state
 *   }
 */
const db = require('../../db');
const wa = require('../whatsappService');
const session = require('../sessionService');
const otp = require('../otpService');
const media = require('../mediaService');
const referral = require('./referralFlow');

// Tech flow mostly messages technicians (TECH line); customer-facing
// messages (OTP request to customer, job-complete confirmation) go via
// the SERVICE line.
const TLINE = { line: 'tech' };
const SLINE = { line: 'service' };

const AREA_MAX = 200; // numbered text has no WhatsApp API limit

// ─────────────────────────────────────────────
// ONBOARDING
// ─────────────────────────────────────────────

async function startOnboarding(phone, referralCode = null) {
  const existingResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [phone]);
  const existing = existingResult.rows[0];

  if (existing && existing.is_verified) {
    await wa.sendText(phone,
      `✅ You're already registered as *${existing.name}*!\n\n` +
      `Status: ${existing.is_active ? '🟢 Active' : '🔴 Inactive'}\n` +
      `Rating: ⭐ ${existing.rating}\n` +
      `Jobs Completed: ${existing.jobs_completed}\n\n` +
      `You'll receive job notifications automatically when jobs are available in your zone.`,
      TLINE
    );
    return;
  }

  if (existing && !existing.is_verified) {
    await wa.sendText(phone,
      `⏳ Your registration for *${existing.name || 'your account'}* is pending admin verification.\n\nWe'll notify you once approved!`,
      TLINE
    );
    return;
  }

  await session.setSession(phone, {
    flow: 'tech_onboarding',
    step: 'awaiting_name',
    actor_type: 'technician',
    context_data: { referral_code: referralCode }
  });

  const referralNote = referralCode ? `\n🤝 _Referred by a Knite technician_\n` : '';
  await wa.sendText(phone,
    `👋 *Welcome to the Knite Technician Network!*\n\n` +
    `💰 Earn ₹300-500 per job\n` +
    `🕐 No fixed hours - work when you want\n` +
    `📱 100% WhatsApp - no app needed\n` +
    `${referralNote}\n` +
    `Let's get you registered. What is your *full name*?`,
    TLINE
  );
}

// ─────────────────────────────────────────────
// Step 1: Name → show state list
// ─────────────────────────────────────────────

async function handleName(phone, name, ctx) {
  if (name.trim().length < 3) {
    await wa.sendText(phone, `Please enter your full name (at least 3 characters):`, TLINE);
    return;
  }

  await session.setSession(phone, {
    flow: 'tech_onboarding',
    step: 'awaiting_flow',
    context_data: { name: name.trim(), all_state_selections: [] }
  });

  await sendAreaSelectionFlow(phone);
}

async function sendAreaSelectionFlow(phone) {
  const flowId = process.env.WA_FLOW_AREA_SELECTION;
  const flowToken = `tech_area_${phone}_${Date.now()}`;
  await wa.sendFlow(phone,
    `📍 *Select your service areas*\n\nEnter the pincodes you cover (comma-separated). We'll figure out the state and areas automatically.`,
    flowId,
    flowToken,
    '📍 Enter Pincodes',
    'PINCODE_SCREEN',
    null,
    false,
    TLINE
  );
}

async function sendStateList(phone, allSelections = []) {
  const result = await db.query(
    `SELECT DISTINCT state FROM india_pincodes WHERE state IS NOT NULL ORDER BY state`
  );
  const allStates = result.rows.map(r => r.state);
  const addedStates = new Set(allSelections.map(s => s.state));

  const addedHeader = allSelections.length > 0
    ? `✅ *Added so far:* ${allSelections.map(s => `${s.state} (${s.selected_areas.length})`).join(', ')}\n\n`
    : '';

  // Show all states; mark already-added ones so tech knows they can add more districts
  const lines = allStates.map((s, i) =>
    `${i + 1}. ${s}${addedStates.has(s) ? ' *(add more districts)*' : ''}`
  ).join('\n');

  await wa.sendText(phone,
    `${addedHeader}📍 Which *state* do you work in?\n\n${lines}\n\nReply with the number.`,
    TLINE
  );
}

// ─────────────────────────────────────────────
// Step 2: State → show area list directly
// ─────────────────────────────────────────────

async function handleState(phone, text, ctx) {
  const allSelections = ctx.all_state_selections || [];

  const allResult = await db.query(
    `SELECT DISTINCT state FROM india_pincodes WHERE state IS NOT NULL ORDER BY state`
  );
  const allStates = allResult.rows.map(r => r.state);
  const total = allStates.length;
  const num = parseInt(text.trim());

  if (isNaN(num) || num < 1 || num > total) {
    await wa.sendText(phone, `❌ Please enter a number between 1 and ${total}.`, TLINE);
    await sendStateList(phone, allSelections);
    return;
  }

  const selectedState = allStates[num - 1];
  if (!selectedState) { await sendStateList(phone, allSelections); return; }

  // Pre-load previously saved areas if re-selecting an existing state
  const existing = allSelections.find(s => s.state === selectedState);
  const preloadedAreas = existing ? existing.selected_areas : [];

  await session.setSession(phone, {
    flow: 'tech_onboarding',
    step: 'awaiting_areas',
    context_data: {
      ...ctx,
      state: selectedState,
      selected_areas: preloadedAreas,
      // Remove old entry for this state — will be re-added on DONE
      all_state_selections: allSelections.filter(s => s.state !== selectedState),
    }
  });

  await sendAreaList(phone, selectedState, preloadedAreas);
}

// ─────────────────────────────────────────────
// Step 3: Area multi-select (all areas in the state)
// ─────────────────────────────────────────────

async function handleAreaSelection(phone, text, ctx) {
  const upper = text.trim().toUpperCase();

  // Done with areas for current state
  if (upper === 'DONE' || upper === 'AREA_DONE') {
    if (!ctx.selected_areas || ctx.selected_areas.length === 0) {
      await wa.sendText(phone, `Please select at least one area first.`, TLINE);
      await sendAreaList(phone, ctx.state, []);
      return;
    }

    const currentSelection = {
      state: ctx.state,
      selected_areas: ctx.selected_areas,
    };
    const allSelections = [...(ctx.all_state_selections || []), currentSelection];

    await session.setSession(phone, {
      flow: 'tech_onboarding',
      step: 'awaiting_more_states',
      context_data: {
        all_state_selections: allSelections,
        // clear transient fields
        state: null, selected_areas: null,
      }
    });

    const totalAreas = allSelections.reduce((sum, s) => sum + s.selected_areas.length, 0);
    const statesSummary = allSelections.map(s => `📍 *${s.state}*: ${s.selected_areas.length} area(s)`).join('\n');

    await wa.sendButtons(phone,
      `✅ *${ctx.state} saved!* — ${ctx.selected_areas.length} area(s)\n\n` +
      `*All states so far (${allSelections.length}):*\n${statesSummary}\n\n` +
      `Total areas: ${totalAreas}\n\nWould you like to add another state?`,
      [
        { id: 'ADD_MORE_STATES', title: '➕ Add another state' },
        { id: 'PROCEED_KYC', title: '✅ Proceed to KYC' },
      ],
      TLINE
    );
    return;
  }

  // Number input → pick area by position
  const num = parseInt(text.trim());
  const areaCountResult = await db.query(
    `SELECT COUNT(*) AS cnt FROM (
       SELECT DISTINCT area_name, district FROM india_pincodes
       WHERE state = $1 AND area_name IS NOT NULL
     ) t`,
    [ctx.state]
  );
  const areaTotal = parseInt(areaCountResult.rows[0].cnt);

  if (isNaN(num) || num < 1 || num > areaTotal) {
    await wa.sendText(phone, `❌ Please enter a number between 1 and ${areaTotal}.`, TLINE);
    await sendAreaList(phone, ctx.state, ctx.selected_areas || []);
    return;
  }

  const areaResult = await db.query(
    `SELECT id, area_name, pincode, district FROM india_pincodes
     WHERE state = $1 AND area_name IS NOT NULL
     ORDER BY district, area_name
     LIMIT 1 OFFSET $2`,
    [ctx.state, num - 1]
  );
  const area = areaResult.rows[0];
  if (!area) { await sendAreaList(phone, ctx.state, ctx.selected_areas || []); return; }

  const selectedAreas = ctx.selected_areas || [];
  const alreadySelected = selectedAreas.some(a => a.id === area.id);
  const newAreas = alreadySelected ? selectedAreas : [...selectedAreas, area];

  await session.setSession(phone, {
    flow: 'tech_onboarding',
    step: 'awaiting_areas',
    context_data: { selected_areas: newAreas }
  });
  await sendAreaList(phone, ctx.state, newAreas);
}

async function sendAreaList(phone, state, selectedAreas) {
  const result = await db.query(
    `SELECT id, area_name, pincode, district FROM india_pincodes
     WHERE state = $1 AND area_name IS NOT NULL
     ORDER BY district, area_name
     LIMIT $2`,
    [state, AREA_MAX]
  );
  const areas = result.rows;
  const selectedIds = new Set((selectedAreas || []).map(a => a.id));

  const selectedStr = selectedAreas && selectedAreas.length > 0
    ? `✅ *Selected (${selectedAreas.length}):* ${selectedAreas.map(a => a.area_name).join(', ')}\n\n`
    : '';

  const lines = areas.map((a, i) =>
    `${i + 1}. ${selectedIds.has(a.id) ? '✓ ' : ''}${a.area_name}`
  ).join('\n');

  await wa.sendText(phone,
    `${selectedStr}📍 *${state}* — Select your service areas:\n\n${lines}\n\nReply with a number to add/select. Type *DONE* when finished.`,
    TLINE
  );
}

// ─────────────────────────────────────────────
// Flow response handler (WhatsApp Flow completion)
// ─────────────────────────────────────────────

async function handleFlowResponse(phone, flowPayload, ctx) {
  // Pincode-only flow (Meta: PINCODE_SCREEN is the sole terminal screen).
  // The state is derived from the india_pincodes lookup — no dropdown needed.
  const { pincodes } = flowPayload;

  if (!pincodes) {
    await wa.sendText(phone, `❌ Something went wrong with the form. Please try again.`, TLINE);
    await sendAreaSelectionFlow(phone);
    return;
  }

  // Parse pincodes from comma-separated input
  const rawPincodes = pincodes.split(/[,\s]+/).map(p => p.trim()).filter(p => /^\d{6}$/.test(p));

  if (rawPincodes.length === 0) {
    await wa.sendText(phone, `❌ No valid 6-digit pincodes found. Please try again.`, TLINE);
    await sendAreaSelectionFlow(phone);
    return;
  }

  // Look up areas from DB. One pincode can have multiple area rows — we keep
  // them all so the tech's coverage is maximally granular.
  const result = await db.query(
    `SELECT id, area_name, pincode, district, state FROM india_pincodes
     WHERE pincode = ANY($1::text[]) AND area_name IS NOT NULL`,
    [rawPincodes]
  );

  const found = result.rows;
  const notFound = rawPincodes.filter(p => !found.some(r => r.pincode === p));

  if (found.length === 0) {
    await wa.sendText(phone,
      `❌ None of the pincodes matched our database. Please check and try again.\n\n` +
      `Invalid: ${rawPincodes.join(', ')}`,
      TLINE
    );
    await sendAreaSelectionFlow(phone);
    return;
  }

  // Group found areas by state. A tech can submit pincodes that span
  // multiple states; each state becomes its own selection entry so zone
  // creation and the summary UI still work per-state.
  const byState = {};
  for (const row of found) {
    const s = row.state || 'Unknown';
    if (!byState[s]) byState[s] = [];
    byState[s].push(row);
  }
  const newSelections = Object.entries(byState).map(([state, areas]) => ({
    state,
    selected_areas: areas,
  }));

  // Merge with any pre-existing selections (if the tech is adding more
  // pincodes). For states that already had an entry, union the areas.
  const existing = ctx.all_state_selections || [];
  const merged = [...existing];
  for (const sel of newSelections) {
    const i = merged.findIndex(e => e.state === sel.state);
    if (i >= 0) {
      const existingIds = new Set(merged[i].selected_areas.map(a => a.id));
      merged[i] = {
        state: sel.state,
        selected_areas: [
          ...merged[i].selected_areas,
          ...sel.selected_areas.filter(a => !existingIds.has(a.id)),
        ],
      };
    } else {
      merged.push(sel);
    }
  }

  const totalAreas = merged.reduce((sum, s) => sum + s.selected_areas.length, 0);
  const statesSummary = merged.map(s => `📍 *${s.state}*: ${s.selected_areas.length} area(s)`).join('\n');

  // Confirmation message — show areas grouped by state
  let confirmMsg = `✅ *Coverage saved!*\n\n`;
  for (const sel of newSelections) {
    confirmMsg += `*${sel.state}:*\n${sel.selected_areas.map(a => `• ${a.area_name} (${a.pincode})`).join('\n')}\n\n`;
  }

  if (notFound.length > 0) {
    confirmMsg += `⚠️ Not found in DB: ${notFound.join(', ')} (skipped)\n\n`;
  }

  confirmMsg += `*All coverage so far (${merged.length} state${merged.length === 1 ? '' : 's'}):*\n${statesSummary}\nTotal areas: ${totalAreas}`;

  await session.setSession(phone, {
    flow: 'tech_onboarding',
    step: 'awaiting_more_states',
    context_data: {
      ...ctx,
      all_state_selections: merged,
      state: null, selected_areas: null,
    }
  });

  await wa.sendButtons(phone, confirmMsg, [
    { id: 'ADD_MORE_STATES', title: '➕ Add more pincodes' },
    { id: 'PROCEED_KYC', title: '✅ Proceed to KYC' },
  ], TLINE);
}

// ─────────────────────────────────────────────
// Step 4b: More states or proceed to KYC
// ─────────────────────────────────────────────

async function handleMoreStates(phone, text, ctx) {
  const upper = text.trim().toUpperCase();
  const allSelections = ctx.all_state_selections || [];

  if (upper === 'ADD_MORE_STATES') {
    await session.setSession(phone, {
      flow: 'tech_onboarding',
      step: 'awaiting_flow',
      context_data: {
        name: ctx.name,
        all_state_selections: allSelections,
        state: null, selected_areas: null,
      }
    });
    await sendAreaSelectionFlow(phone);
    return;
  }

  if (upper === 'PROCEED_KYC') {
    if (allSelections.length === 0) {
      await wa.sendText(phone, `Please add at least one state first.`, TLINE);
      return;
    }

    // Create/upsert zones for every district in every state selection
    const allZoneIds = [];
    let homeZoneId = null;
    const zoneSummaryLines = [];

    for (const selection of allSelections) {
      // Group pincodes by district
      const districtPincodes = {};
      for (const area of selection.selected_areas) {
        if (!districtPincodes[area.district]) districtPincodes[area.district] = [];
        districtPincodes[area.district].push(area.pincode);
      }

      for (const [district, pincodes] of Object.entries(districtPincodes)) {
        const zoneId = await upsertZone(selection.state, district, pincodes);
        allZoneIds.push(zoneId);
        if (!homeZoneId) homeZoneId = zoneId;
      }

      zoneSummaryLines.push(
        `📍 *${selection.state}*: ${selection.selected_areas.length} area(s)`
      );
    }

    const totalAreas = allSelections.reduce((sum, s) => sum + s.selected_areas.length, 0);
    const stateNames = allSelections.map(s => s.state).join(', ');

    await session.setSession(phone, {
      flow: 'tech_onboarding',
      step: 'awaiting_kyc_front',
      context_data: {
        name: ctx.name,
        all_state_selections: allSelections,
        all_zone_ids: allZoneIds,
        home_zone_id: homeZoneId,
        home_zone_name: stateNames,
        areas_summary: `${totalAreas} area(s) across ${allSelections.length} state(s)`,
        zone_summary: zoneSummaryLines.join('\n'),
        referral_code: ctx.referral_code || null,
      }
    });

    await wa.sendText(phone,
      `✅ *Coverage registered!*\n\n` +
      `*Your service zones:*\n${zoneSummaryLines.join('\n')}\n\n` +
      `Total areas: ${totalAreas}\n\n` +
      `📸 *KYC — Step 1 of 2*\n` +
      `Please send a photo of the *FRONT side* of your Aadhaar card:`,
      TLINE
    );
    return;
  }

  // Unrecognised input — re-prompt
  const stateNames = allSelections.map(s => s.state).join(', ');
  await wa.sendButtons(phone,
    `✅ *Coverage so far:* ${stateNames}\n\nWould you like to add more pincodes or proceed to KYC?`,
    [
      { id: 'ADD_MORE_STATES', title: '➕ Add more pincodes' },
      { id: 'PROCEED_KYC', title: '✅ Proceed to KYC' },
    ],
    TLINE
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
// Step 5: KYC — FRONT photo
//
// Two-part flow:
//   awaiting_kyc_front → user sends Aadhaar FRONT → store URL in session,
//                        prompt for BACK, advance to awaiting_kyc_back
//   awaiting_kyc_back  → user sends Aadhaar BACK  → create tech row with
//                        both URLs, notify admin, finish
// ─────────────────────────────────────────────

async function handleKYCFront(phone, mediaId, ctx) {
  if (!mediaId) {
    await wa.sendText(phone,
      `📸 *KYC — Step 1 of 2*\nPlease send a photo of the *FRONT side* of your Aadhaar card:`,
      TLINE
    );
    return;
  }

  const frontUrl = await media.storeMedia(mediaId, 'kyc', `${phone.replace('+', '')}_front`);

  // Advance to awaiting_kyc_back; carry everything forward in context.
  await session.setSession(phone, {
    flow: 'tech_onboarding',
    step: 'awaiting_kyc_back',
    context_data: {
      ...ctx,
      kyc_front_url: frontUrl || 'simulator_upload',
    },
  });

  await wa.sendText(phone,
    `✅ Front side received.\n\n` +
    `📸 *KYC — Step 2 of 2*\n` +
    `Now please send a photo of the *BACK side* of your Aadhaar card:`,
    TLINE
  );
}

// ─────────────────────────────────────────────
// Step 5b: KYC — BACK photo  (finalises onboarding)
// ─────────────────────────────────────────────

async function handleKYCBack(phone, mediaId, ctx) {
  if (!mediaId) {
    await wa.sendText(phone,
      `📸 *KYC — Step 2 of 2*\nPlease send a photo of the *BACK side* of your Aadhaar card:`,
      TLINE
    );
    return;
  }

  // Clear session immediately to prevent duplicate submissions if the user
  // sends multiple photos before the DB insert settles.
  await session.clearSession(phone);

  const backUrl = await media.storeMedia(mediaId, 'kyc', `${phone.replace('+', '')}_back`);
  const frontUrl = ctx.kyc_front_url || 'simulator_upload';

  const techResult = await db.query(
    `INSERT INTO technicians (phone, name, home_zone_id, is_verified, is_active, kyc_doc_url, kyc_doc_back_url)
     VALUES ($1, $2, $3, false, false, $4, $5)
     ON CONFLICT (phone) DO UPDATE SET
       name = $2, home_zone_id = $3, kyc_doc_url = $4, kyc_doc_back_url = $5
     RETURNING *`,
    [phone, ctx.name, ctx.home_zone_id, frontUrl, backUrl || 'simulator_upload']
  );
  const tech = techResult.rows[0];

  // Link technician to all selected zones
  const zoneIds = ctx.all_zone_ids && ctx.all_zone_ids.length > 0
    ? ctx.all_zone_ids
    : [ctx.home_zone_id].filter(Boolean);

  for (const zoneId of zoneIds) {
    await db.query(
      `INSERT INTO technician_zones (technician_id, zone_id, is_home) VALUES ($1, $2, $3)
       ON CONFLICT (technician_id, zone_id) DO UPDATE SET is_home = $3`,
      [tech.id, zoneId, zoneId === ctx.home_zone_id]
    );
  }

  // Generate referral code for this new technician
  await referral.ensureReferralCode(tech.id);

  // Save referral mapping if they registered via a referral link
  if (ctx.referral_code) {
    await referral.saveReferral(tech.id, ctx.referral_code);
  }

  const statesSummary = ctx.zone_summary || ctx.home_zone_name || 'N/A';
  const areasSummary = ctx.areas_summary || 'N/A';

  // Notify admin
  const adminResult = await db.query(`SELECT phone FROM customers WHERE phone = '919999999999'`);
  if (adminResult.rows[0]) {
    await wa.sendButtons(adminResult.rows[0].phone,
      `🆕 *New Technician Application*\n\n` +
      `👤 Name: ${ctx.name}\n` +
      `📱 Phone: ${phone}\n` +
      `📍 Service zones:\n${statesSummary}\n` +
      `🏘️ Coverage: ${areasSummary}\n` +
      `🪪 KYC: Front + back uploaded\n\n` +
      `Tech ID: ${tech.id}`,
      [
        { id: `APPROVE_TECH_${tech.id}`, title: '✅ Approve' },
        { id: `REJECT_TECH_${tech.id}`, title: '❌ Reject' },
      ],
      TLINE
    );
  }

  await session.clearSession(phone);
  await wa.sendText(phone,
    `✅ *Registration submitted successfully!*\n\n` +
    `📋 Details:\n` +
    `• Name: ${ctx.name}\n` +
    `• Service zones:\n${statesSummary}\n` +
    `• Coverage: ${areasSummary}\n` +
    `• KYC: Front + back submitted\n\n` +
    `⏳ Our admin will review your application within 24 hours.\n` +
    `You'll receive a WhatsApp notification once approved! 🎉`,
    TLINE
  );
}

// ─────────────────────────────────────────────
// JOB OPERATIONS
// ─────────────────────────────────────────────

async function handleJobAccept(phone, jobId) {
  const techResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [phone]);
  const tech = techResult.rows[0];

  if (!tech || !tech.is_active) {
    await wa.sendText(phone, `❌ You need to be a verified technician to accept jobs.`, TLINE);
    return;
  }

  const result = await db.query(`SELECT accept_job_broadcast($1, $2) AS accepted`, [jobId, tech.id]);
  const accepted = result.rows[0].accepted;

  if (!accepted) {
    await wa.sendText(phone,
      `⚡ *Too late!* This job was already taken by another technician.\n\nStay tuned for the next one! 💪`,
      TLINE
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
    `🎉 Ask customer for the *Happiness Code* after completing the work.\n\n` +
    `_Head to the location now!_`,
    [
      { id: `ARRIVED_${jobId}`, title: '📍 I Have Arrived' },
      { id: `CANCEL_JOB_${jobId}`, title: '❌ Cancel' },
    ],
    TLINE
  );

  // Send location pin if customer shared their location
  if (address.location?.latitude && address.location?.longitude) {
    await wa.sendLocation(
      phone,
      address.location.latitude,
      address.location.longitude,
      address.raw || 'Installation Location',
      address.full_address || address.raw || '',
      TLINE
    );
  }

  await wa.sendText(job.customer_phone,
    `👨‍🔧 *Technician Assigned!*\n\n` +
    `Name: ${tech.name}\n` +
    `Phone: ${tech.phone}\n` +
    `⭐ Rating: ${tech.rating}\n\n` +
    `They are on their way! Share the *Happiness Code only after the work is completed.*`,
    SLINE
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

  await wa.sendText(phone, `👍 Got it! You've declined this job. We'll notify you of future opportunities.`, TLINE);
}

async function handleArrived(phone, jobId) {
  const techResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [phone]);
  if (!techResult.rows[0]) return;
  const tech = techResult.rows[0];

  await db.query(
    `UPDATE jobs SET status = 'arrived', updated_at = now() WHERE id = $1 AND status = 'assigned'`,
    [jobId]
  );
  await db.query(
    `SELECT log_job_event($1, 'arrived', 'assigned', 'arrived', 'technician', $2, '{}')`,
    [jobId, tech.id]
  );

  await session.setSession(phone, {
    flow: 'tech_job',
    step: 'awaiting_otp',
    context_data: { job_id: jobId, tech_id: tech.id }
  });

  await wa.sendText(phone, `📍 *Arrival confirmed!*\n\nComplete the work, then ask the customer for the *Happiness Code* and enter it here:`, TLINE);
}

async function handleOTPVerification(phone, otpInput, ctx) {
  const jobResult = await db.query(`SELECT * FROM jobs WHERE id = $1`, [ctx.job_id]);
  const job = jobResult.rows[0];
  if (!job) { await wa.sendText(phone, `❌ Job not found.`, TLINE); return; }

  const isValid = await otp.verifyOTP(otpInput.trim(), job.otp_hash);
  if (!isValid) {
    await wa.sendText(phone, `❌ *Invalid Happiness Code!* Please ask the customer to check and share again.`, TLINE);
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
    `_(Required for payment release)_`,
    TLINE
  );
}

async function handleCompletionPhoto(phone, mediaId, ctx) {
  const photoUrl = await media.storeMedia(mediaId, 'proof', `${phone}_${ctx.job_id}`);
  const photos = [...(ctx.photos || []), photoUrl];

  if (photos.length < 2) {
    await session.updateContext(phone, { photos });
    await wa.sendText(phone, `📸 Photo ${photos.length}/2 received. Send ${2 - photos.length} more photo(s) to complete.`, TLINE);
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
    `💰 Payment will be released after customer confirms.\n_(Auto-released in 4 hours if no response)_`,
    TLINE
  );

  await wa.sendButtons(job.customer_phone,
    `🔧 *Work Completed on ${job.unit_code}!*\n\n` +
    `Your technician has completed the ${job.type} and submitted photos.\n\nWas the work done satisfactorily?`,
    [
      { id: `VERIFY_YES_${ctx.job_id}`, title: '✅ Yes, All Good!' },
      { id: `VERIFY_NO_${ctx.job_id}`, title: '❌ No, Issue Remains' },
    ],
    SLINE
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
    await wa.sendText(phone, `✅ Technician *${tech.name}* (${tech.phone}) has been *approved and activated*.`, TLINE);
    await wa.sendText(tech.phone,
      `🎉 *Congratulations ${tech.name}!*\n\nYour Knite technician account is now *ACTIVE*! ✅\n\n` +
      `You'll start receiving job notifications in your zone.\n\n` +
      `💡 Tips:\n• Accept jobs quickly - first accepted wins!\n` +
      `• Maintain high ratings for priority job access\n• Typical earnings: ₹700-1,600/day\n` +
      `• 🤝 Refer other technicians and earn ₹50 for every 5 jobs they complete\n\n` +
      `Welcome to the team! 🔧`,
      TLINE
    );

    // Send the full tech portal menu so Refer & Pending Jobs are immediately
    // visible as reply buttons (no need for the tech to type "Hi" first).
    await wa.sendButtons(tech.phone,
      `👋 *Knite Technician Portal*\n\nYou'll receive job notifications automatically.\n\nWhat do you need?`,
      [
        { id: 'TECH_PENDING_JOBS', title: '🔧 Pending Jobs' },
        { id: 'REFER_TECH', title: '🤝 Refer & Earn' },
        { id: 'HELP', title: '❓ Help' },
      ],
      TLINE
    );
  } else {
    await db.query(`UPDATE technicians SET updated_at = now() WHERE id = $1`, [techId]);
    const techResult = await db.query(`SELECT * FROM technicians WHERE id = $1`, [techId]);
    const tech = techResult.rows[0];
    await wa.sendText(phone, `❌ Technician *${tech?.name}* application rejected.`, TLINE);
    if (tech) {
      await wa.sendText(tech.phone,
        `❌ Your application needs a clearer Aadhaar photo.\n\nPlease type *REGISTER TECH* to resubmit.`,
        TLINE
      );
    }
  }
}

module.exports = {
  startOnboarding,
  handleName,
  sendAreaSelectionFlow,
  handleFlowResponse,
  handleMoreStates,
  handleKYCFront,
  handleKYCBack,
  handleJobAccept,
  handleJobDecline,
  handleArrived,
  handleOTPVerification,
  handleCompletionPhoto,
  handleAdminApproval,
};
