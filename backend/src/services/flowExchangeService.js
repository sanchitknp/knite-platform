/**
 * WhatsApp Flow Encrypted Data Exchange
 *
 * When a user opens a flow that has an endpoint_uri, WhatsApp sends an
 * encrypted POST request. This service handles decryption, data lookup,
 * and encrypted response.
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

/**
 * Decrypt an incoming flow request from WhatsApp
 */
function decryptRequest(body) {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

  // Decrypt the AES key using our RSA private key
  const aesKey = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(encrypted_aes_key, 'base64')
  );

  // Decrypt the flow data using AES-128-GCM
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
  // Flip every bit of the IV
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
 * Called by WhatsApp when a user opens a flow with an endpoint_uri
 */
async function handleFlowExchange(req, res) {
  // Plain-text health check (GET or POST with action=ping not encrypted)
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

  console.log('[FLOW EXCHANGE] action=%s screen=%s token=%s',
    decryptedBody.action, decryptedBody.screen, decryptedBody.flow_token);

  // Encrypted health check ping — respond with encrypted active status
  if (decryptedBody.action === 'ping') {
    const encrypted = encryptResponse({ data: { status: 'active' } }, aesKey, iv);
    return res.send(encrypted);
  }

  let responseData;

  try {
    responseData = await buildResponse(decryptedBody);
  } catch (err) {
    console.error('[FLOW EXCHANGE] Build response error:', err.message);
    responseData = { screen: 'JOB_DETAIL', data: { error: 'Failed to load job details' } };
  }

  const encrypted = encryptResponse(responseData, aesKey, iv);
  res.send(encrypted);
}

/**
 * Build the response payload based on the action received
 */
async function buildResponse(body) {
  const { action, flow_token } = body;

  // INIT: user opened the flow — load job data and return it
  if (action === 'INIT') {
    return await buildJobDetailScreen(flow_token);
  }

  // BACK: user pressed back (not used in single-screen flow)
  if (action === 'BACK') {
    return await buildJobDetailScreen(flow_token);
  }

  // data_exchange: user submitted form / tapped footer (complete action)
  if (action === 'data_exchange') {
    return { screen: 'SUCCESS', data: {} };
  }

  return await buildJobDetailScreen(flow_token);
}

/**
 * Look up job by ID (flow_token = job UUID) and build screen data
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
      screen: 'JOB_DETAIL',
      data: {
        job_type: '❌ Job Not Found',
        unit_code: '-',
        address: '-',
        pincode: '-',
        customer: '-',
        phone: '-',
        slot: '-',
        payout: '-',
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
