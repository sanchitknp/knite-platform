/**
 * WhatsApp Flow Encrypted Data Exchange
 *
 * Handles the full job lifecycle inside a single WhatsApp Flow:
 *   PENDING_JOBS → JOB_DETAIL → OTP_ENTRY → JOB_COMPLETE
 *
 * Encryption scheme:
 *  - AES key encrypted with our RSA-2048 public key (OAEP + SHA-256)
 *  - Flow data encrypted with AES-128-GCM
 *  - Response encrypted with same AES key but bit-flipped IV
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const otp = require('./otpService');
const session = require('./sessionService');
const wa = require('./whatsappService');

const PRIVATE_KEY_PATH = path.join(__dirname, '../../flow_private_key.pem');
const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decryptRequest(body) {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

  const aesKey = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(encrypted_aes_key, 'base64')
  );

  const iv = Buffer.from(initial_vector, 'base64');
  const encryptedDataWithTag = Buffer.from(encrypted_flow_data, 'base64');
  const TAG_LENGTH = 16;
  const encryptedData = encryptedDataWithTag.slice(0, -TAG_LENGTH);
  const authTag = encryptedDataWithTag.slice(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

  return {
    decryptedBody: JSON.parse(decrypted.toString('utf8')),
    aesKey,
    iv,
  };
}

function encryptResponse(responseData, aesKey, iv) {
  const flippedIv = Buffer.from(iv.map(b => ~b & 0xff));

  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, flippedIv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(responseData), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([encrypted, tag]).toString('base64');
}

async function handleFlowExchange(req, res) {
  console.log('[FLOW EXCHANGE] Incoming: method=%s body_keys=%s',
    req.method, Object.keys(req.body || {}).join(','));

  if (req.method === 'GET' || req.body?.action === 'ping') {
    return res.json({ data: { status: 'active' } });
  }

  let aesKey, iv, decryptedBody;

  try {
    ({ decryptedBody, aesKey, iv } = decryptRequest(req.body));
  } catch (err) {
    console.error('[FLOW EXCHANGE] Decryption failed:', err.message);
    return res.status(421).json({ error: 'decryption_failed' });
  }

  console.log('[FLOW EXCHANGE] Decrypted: action=%s screen=%s token=%s data=%s',
    decryptedBody.action, decryptedBody.screen, decryptedBody.flow_token,
    JSON.stringify(decryptedBody.data || {}));

  if (decryptedBody.action === 'ping') {
    const encrypted = encryptResponse({ version: '3.0', data: { status: 'active' } }, aesKey, iv);
    return res.send(encrypted);
  }

  let responseData;
  try {
    responseData = await buildResponse(decryptedBody);
  } catch (err) {
    console.error('[FLOW EXCHANGE] Build response error:', err);
    responseData = {
      version: '3.0',
      screen: 'PENDING_JOBS',
      data: { header: 'Error loading jobs — please try again.', jobs: [] },
    };
  }

  console.log('[FLOW EXCHANGE] Response: screen=%s', responseData.screen);
  const encrypted = encryptResponse(responseData, aesKey, iv);
  res.send(encrypted);
}

async function buildResponse(body) {
  const { action, flow_token, screen, data } = body;

  if (action === 'INIT') {
    if (UUID_RE.test(flow_token)) {
      return await buildLegacyJobDetailScreen(flow_token);
    }
    return await buildPendingJobsScreen(flow_token);
  }

  if (action === 'BACK') {
    return await buildPendingJobsScreen(flow_token);
  }

  if (action === 'data_exchange') {
    if (screen === 'PENDING_JOBS' && data?.selected_job) {
      return await buildJobDetailScreen(data.selected_job);
    }

    if (screen === 'JOB_DETAIL' && data?.job_id) {
      return await handleJobDetailAction(data.job_id, flow_token);
    }

    if (screen === 'OTP_ENTRY' && data?.job_id) {
      return await handleOTPSubmission(data.job_id, data.otp, flow_token);
    }

    return { version: '3.0', screen: 'JOB_COMPLETE', data: {
      message: '✅ Done',
      subtitle: 'No action needed.',
    }};
  }

  return await buildPendingJobsScreen(flow_token);
}

// ─── Screen builders ─────────────────────────────────────────────────────────

const TYPE_ICON  = { install: '🔧', repair: '🛠️', maintenance: '🔄' };
const TYPE_LABEL = { install: '🔧 Installation', repair: '🛠️ Repair', maintenance: '🔄 Maintenance' };
const STATUS_LABEL = {
  assigned: '📋 Assigned',
  en_route: '🚗 En Route',
  arrived: '📍 Arrived',
  in_progress: '🔧 In Progress',
  pending_verification: '⏳ Awaiting Verification',
};

function formatSlot(scheduledStart) {
  if (!scheduledStart) return 'ASAP';
  return new Date(scheduledStart).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function buildPendingJobsScreen(techPhone) {
  const techResult = await db.query(
    `SELECT id FROM technicians WHERE phone = $1`,
    [techPhone]
  );
  const tech = techResult.rows[0];

  if (!tech) {
    return {
      version: '3.0',
      screen: 'PENDING_JOBS',
      data: { header: 'No technician account found.', jobs: [] },
    };
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

  const jobs = jobsResult.rows.map(j => {
    const address = j.install_address || {};
    const pincode = address.pincode ? ` · ${address.pincode}` : '';
    const slot = formatSlot(j.scheduled_start);

    return {
      id: j.id,
      title: `${TYPE_ICON[j.type] || '🔧'} ${j.unit_code}${pincode}`,
      description: `${slot} · ₹${Math.round(j.payout_paise / 100)} · ${STATUS_LABEL[j.status] || j.status}`,
    };
  });

  const count = jobs.length;
  const header = count === 0
    ? 'No pending jobs right now.'
    : `${count} pending job${count > 1 ? 's' : ''} — select one to view details`;

  return {
    version: '3.0',
    screen: 'PENDING_JOBS',
    data: { header, jobs },
  };
}

async function loadJob(jobId) {
  const result = await db.query(
    `SELECT j.*, u.unit_id as unit_code, u.install_address,
            c.phone as customer_phone, c.name as customer_name
     FROM jobs j
     JOIN units u ON u.id = j.unit_id
     JOIN customers c ON c.id = j.customer_id
     WHERE j.id = $1`,
    [jobId]
  );
  return result.rows[0];
}

function getActionLabel(status) {
  switch (status) {
    case 'assigned':              return '📍 Mark Arrived';
    case 'en_route':
    case 'arrived':               return '🔐 Enter Happiness Code';
    case 'in_progress':           return '📸 Send Photos in Chat';
    case 'pending_verification':  return '⏳ Awaiting Verification';
    default:                      return 'View';
  }
}

async function buildJobDetailScreen(jobId) {
  const j = await loadJob(jobId);
  if (!j) {
    return {
      version: '3.0',
      screen: 'JOB_DETAIL',
      data: {
        job_id: jobId,
        header: '❌ Job Not Found',
        address: '—', customer: '—', slot: '—', payout: '—',
        status_label: 'Unknown', action_label: 'Close',
      },
    };
  }

  const address = j.install_address || {};
  const addressLines = [address.raw || address.full_address].filter(Boolean);
  if (address.pincode) addressLines.push(`Pincode: ${address.pincode}`);

  return {
    version: '3.0',
    screen: 'JOB_DETAIL',
    data: {
      job_id:       j.id,
      header:       `${TYPE_LABEL[j.type] || j.type} — ${j.unit_code}`,
      address:      addressLines.join('\n') || 'Address not set',
      customer:     `${j.customer_name || 'Customer'} · ${j.customer_phone}`,
      slot:         formatSlot(j.scheduled_start),
      payout:       `₹${Math.round(j.payout_paise / 100)}`,
      status_label: STATUS_LABEL[j.status] || j.status,
      action_label: getActionLabel(j.status),
    },
  };
}

/**
 * Technician tapped the action button on JOB_DETAIL.
 * Behavior depends on current job status.
 */
async function handleJobDetailAction(jobId, techPhone) {
  const j = await loadJob(jobId);
  if (!j) {
    return { version: '3.0', screen: 'JOB_COMPLETE', data: {
      message: '❌ Job not found', subtitle: 'This job may have been cancelled.',
    }};
  }

  const techResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [techPhone]);
  const tech = techResult.rows[0];

  if (j.status === 'assigned') {
    // Mark arrived: update DB status and set session for OTP collection
    await db.query(
      `UPDATE jobs SET status = 'arrived', updated_at = now() WHERE id = $1`,
      [jobId]
    );
    if (tech) {
      await db.query(
        `SELECT log_job_event($1, 'arrived', 'assigned', 'arrived', 'technician', $2, '{}')`,
        [jobId, tech.id]
      );
    }
    console.log('[FLOW] Tech %s marked arrived for job %s', techPhone, jobId);

    return {
      version: '3.0',
      screen: 'OTP_ENTRY',
      data: {
        job_id: jobId,
        subtitle: '📍 Arrival confirmed!\n\nComplete the work, then ask the customer for their 6-digit Happiness Code.',
        error_msg: ' ',
      },
    };
  }

  if (j.status === 'en_route' || j.status === 'arrived') {
    return {
      version: '3.0',
      screen: 'OTP_ENTRY',
      data: {
        job_id: jobId,
        subtitle: 'Ask the customer for their 6-digit Happiness Code after completing the work.',
        error_msg: ' ',
      },
    };
  }

  if (j.status === 'in_progress') {
    return { version: '3.0', screen: 'JOB_COMPLETE', data: {
      message: '🔧 Work In Progress',
      subtitle: 'OTP already verified. Close this form and send 2 completion photos in the chat to finish the job.\n\n📸 1. Before/during work\n📸 2. Completed installation',
    }};
  }

  if (j.status === 'pending_verification') {
    return { version: '3.0', screen: 'JOB_COMPLETE', data: {
      message: '⏳ Awaiting Customer Verification',
      subtitle: 'Photos submitted. Waiting for the customer to confirm.\n\nPayment auto-releases in 4 hours if no response.',
    }};
  }

  return { version: '3.0', screen: 'JOB_COMPLETE', data: {
    message: `Job Status: ${j.status}`,
    subtitle: 'No further actions available for this job.',
  }};
}

/**
 * Technician submitted the Happiness Code on OTP_ENTRY screen.
 * Verifies the code, updates the job, and sets up photo collection in chat.
 */
async function handleOTPSubmission(jobId, otpInput, techPhone) {
  const j = await loadJob(jobId);
  if (!j) {
    return { version: '3.0', screen: 'JOB_COMPLETE', data: {
      message: '❌ Job not found', subtitle: 'This job may have been cancelled.',
    }};
  }

  const otpStr = String(otpInput || '').trim();
  if (!otpStr || otpStr.length < 4) {
    return {
      version: '3.0',
      screen: 'OTP_ENTRY',
      data: {
        job_id: jobId,
        subtitle: 'Ask the customer for their 6-digit Happiness Code.',
        error_msg: '❌ Please enter a valid 6-digit code.',
      },
    };
  }

  const isValid = await otp.verifyOTP(otpStr, j.otp_hash);
  if (!isValid) {
    console.log('[FLOW] Invalid OTP for job %s from %s', jobId, techPhone);
    return {
      version: '3.0',
      screen: 'OTP_ENTRY',
      data: {
        job_id: jobId,
        subtitle: 'The code didn\'t match. Ask the customer to check and share the correct Happiness Code.',
        error_msg: '❌ Invalid Happiness Code! Please try again.',
      },
    };
  }

  // OTP valid — update job and prepare for photo collection
  const techResult = await db.query(`SELECT * FROM technicians WHERE phone = $1`, [techPhone]);
  const tech = techResult.rows[0];
  const techId = tech?.id;

  await db.query(
    `UPDATE jobs SET status = 'in_progress', started_at = now(), otp_verified = true, updated_at = now() WHERE id = $1`,
    [jobId]
  );

  if (techId) {
    await db.query(
      `SELECT log_job_event($1, 'otp_verified', 'arrived', 'in_progress', 'technician', $2, '{}')`,
      [jobId, techId]
    );
  }

  // Set session so chat picks up photo uploads after the flow closes
  await session.setSession(techPhone, {
    flow: 'tech_job',
    step: 'awaiting_completion_photos',
    context_data: { job_id: jobId, tech_id: techId, photos: [] },
  });

  // Send a chat message prompting for photos (arrives after they close the flow)
  wa.sendText(techPhone,
    `✅ *Happiness Code verified!*\n\n` +
    `Now send *2 photos* in this chat:\n` +
    `📸 1. Before/during work\n📸 2. Completed ${j.type}\n\n` +
    `_(Required for payment release)_`
  ).catch(err => console.error('[FLOW] Failed to send photo prompt:', err.message));

  console.log('[FLOW] OTP verified for job %s by %s — awaiting photos', jobId, techPhone);

  return {
    version: '3.0',
    screen: 'JOB_COMPLETE',
    data: {
      message: '✅ Happiness Code Verified!',
      subtitle: 'Close this form and send 2 completion photos in the chat.\n\n📸 1. Before/during work\n📸 2. Completed installation\n\nPayment will be released after customer confirms.',
    },
  };
}

// ─── Legacy support ──────────────────────────────────────────────────────────

async function buildLegacyJobDetailScreen(jobId) {
  const j = await loadJob(jobId);
  if (!j) {
    return {
      version: '3.0',
      screen: 'JOB_DETAIL',
      data: {
        job_id: jobId,
        header: '❌ Job Not Found',
        address: '—', customer: '—', slot: '—', payout: '—',
        status_label: 'Unknown', action_label: 'Close',
      },
    };
  }

  const address = j.install_address || {};
  const addressLines = [address.raw || address.full_address].filter(Boolean);
  if (address.pincode) addressLines.push(`Pincode: ${address.pincode}`);

  return {
    version: '3.0',
    screen: 'JOB_DETAIL',
    data: {
      job_id:       j.id,
      header:       `${TYPE_LABEL[j.type] || j.type} — ${j.unit_code}`,
      address:      addressLines.join('\n') || 'Address not set',
      customer:     `${j.customer_name || 'Customer'} · ${j.customer_phone}`,
      slot:         formatSlot(j.scheduled_start),
      payout:       `₹${Math.round(j.payout_paise / 100)}`,
      status_label: STATUS_LABEL[j.status] || j.status,
      action_label: getActionLabel(j.status),
    },
  };
}

module.exports = { handleFlowExchange };
