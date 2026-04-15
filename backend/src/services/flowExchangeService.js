/**
 * WhatsApp Flow Encrypted Data Exchange
 *
 * Handles two flows:
 *  1. JOB_DETAIL  (legacy single-screen) — flow_token = job UUID
 *  2. PENDING_JOBS (two-screen)          — flow_token = tech phone number
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

// Load RSA private key once at startup
const PRIVATE_KEY_PATH = path.join(__dirname, '../../flow_private_key.pem');
const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');

// UUID v4 pattern — used to distinguish job-UUID tokens from phone-number tokens
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Decrypt an incoming flow request from WhatsApp
 */
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

/**
 * Encrypt a response to send back to WhatsApp
 * Uses the same AES key but with a bit-flipped IV
 */
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

/**
 * Main handler for POST /api/flow-exchange
 */
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
    console.error('[FLOW EXCHANGE] Build response error:', err.message);
    responseData = {
      version: '3.0',
      screen: 'PENDING_JOBS',
      data: { header: 'Error loading jobs — please try again.', jobs: [] },
    };
  }

  const encrypted = encryptResponse(responseData, aesKey, iv);
  res.send(encrypted);
}

/**
 * Route the request to the right screen builder
 */
async function buildResponse(body) {
  const { action, flow_token, screen, data } = body;

  if (action === 'INIT') {
    // Distinguish the two flows by token format:
    //  UUID → old single-screen JOB_DETAIL flow (flow_token = job id)
    //  phone → new PENDING_JOBS flow (flow_token = tech phone)
    if (UUID_RE.test(flow_token)) {
      return await buildLegacyJobDetailScreen(flow_token);
    }
    return await buildPendingJobsScreen(flow_token);
  }

  if (action === 'BACK') {
    // Back from JOB_DETAIL → go back to jobs list
    return await buildPendingJobsScreen(flow_token);
  }

  if (action === 'data_exchange') {
    if (screen === 'PENDING_JOBS' && data?.selected_job) {
      // Technician selected a job → show its details
      return await buildJobDetailScreen(data.selected_job);
    }
    // JOB_DETAIL "Close" footer (complete action) — shouldn't reach here, but handle gracefully
    return { version: '3.0', screen: 'SUCCESS', data: {} };
  }

  return await buildPendingJobsScreen(flow_token);
}

// ─── Screen builders ─────────────────────────────────────────────────────────

/**
 * PENDING_JOBS screen — loads all pending/assigned jobs for a technician
 * flow_token = tech phone number
 */
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
      data: {
        header: 'No technician account found.',
        jobs: [],
      },
    };
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

  const typeIcon = { install: '🔧', repair: '🛠️', maintenance: '🔄' };

  const jobs = jobsResult.rows.map(j => {
    const address = j.install_address || {};
    const pincode = address.pincode ? ` · ${address.pincode}` : '';
    const slot = j.scheduled_start
      ? new Date(j.scheduled_start).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
          hour: '2-digit', minute: '2-digit',
        })
      : 'ASAP';

    return {
      id: j.id,
      title: `${typeIcon[j.type] || '🔧'} ${j.unit_code}${pincode}`,
      description: `${slot} · ₹${Math.round(j.payout_paise / 100)}`,
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

/**
 * JOB_DETAIL screen — loads a specific job by UUID
 * Called after technician selects a job from PENDING_JOBS
 */
async function buildJobDetailScreen(jobId) {
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
    return {
      version: '3.0',
      screen: 'JOB_DETAIL',
      data: {
        header:   '❌ Job Not Found',
        address:  '—',
        customer: '—',
        slot:     '—',
        payout:   '—',
      },
    };
  }

  const address = j.install_address || {};
  const typeLabel = { install: '🔧 Installation', repair: '🛠️ Repair', maintenance: '🔄 Maintenance' };
  const slot = j.scheduled_start
    ? new Date(j.scheduled_start).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
        year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : 'ASAP';

  const addressLines = [address.raw || address.full_address].filter(Boolean);
  if (address.pincode) addressLines.push(`Pincode: ${address.pincode}`);

  return {
    version: '3.0',
    screen: 'JOB_DETAIL',
    data: {
      header:   `${typeLabel[j.type] || j.type} — ${j.unit_code}`,
      address:  addressLines.join('\n') || 'Address not set',
      customer: `${j.customer_name || 'Customer'} · ${j.customer_phone}`,
      slot,
      payout:   `₹${Math.round(j.payout_paise / 100)}`,
    },
  };
}

/**
 * Legacy single-screen JOB_DETAIL flow (old WA_FLOW_JOB_DETAIL)
 * flow_token = job UUID — kept for backward compatibility
 */
async function buildLegacyJobDetailScreen(jobId) {
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
    return {
      version: '3.0',
      screen: 'JOB_DETAIL',
      data: {
        job_type: '❌ Job Not Found',
        unit_code: '-', address: '-', pincode: '-',
        customer: '-', phone: '-', slot: '-', payout: '-',
      },
    };
  }

  const address = j.install_address || {};
  const typeLabel = { install: '🔧 Installation', repair: '🛠️ Repair', maintenance: '🔄 Maintenance' };
  const slot = j.scheduled_start
    ? new Date(j.scheduled_start).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
        year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : 'ASAP';

  return {
    version: '3.0',
    screen: 'JOB_DETAIL',
    data: {
      job_type: typeLabel[j.type] || j.type,
      unit_code: j.unit_code,
      address: address.raw || address.full_address || 'Not set',
      pincode: address.pincode || 'N/A',
      customer: j.customer_name || 'Customer',
      phone: j.customer_phone,
      slot,
      payout: `₹${Math.round(j.payout_paise / 100)}`,
    },
  };
}

module.exports = { handleFlowExchange };
