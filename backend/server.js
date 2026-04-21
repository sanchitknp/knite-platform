require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const cookieParser = require('cookie-parser');

const db = require('./src/db');
const webhook = require('./src/controllers/webhookController');
const admin = require('./src/controllers/adminController');
const adminAuth = require('./src/controllers/adminAuthController');
const { adminAuth: requireAdmin } = require('./src/middleware/adminAuth');
const wa = require('./src/services/whatsappService');
const crons = require('./src/jobs/cronJobs');
const { handleFlowExchange } = require('./src/services/flowExchangeService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(morgan('dev'));
app.use(cookieParser());

// ─────────────────────────────────────────────
// WHATSAPP FLOW DATA EXCHANGE ENDPOINT
// Must be registered BEFORE express.json() so we receive the raw
// encrypted binary body that Meta sends.
// ─────────────────────────────────────────────
app.get('/api/flow-exchange', (req, res) => res.json({ data: { status: 'active' } }));
app.post('/api/flow-exchange', express.json(), handleFlowExchange);

app.use(express.json({ limit: '10mb' }));

// Serve frontend files (mounted at /app/frontend in Docker, or ../frontend locally)
const frontendPath = process.env.FRONTEND_PATH || path.join(__dirname, 'frontend');
app.use(express.static(frontendPath));

// Serve uploaded media files (KYC docs, proof photos, issue photos)
const fs = require('fs');
const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

// Dev only: directory listing so admins can browse uploaded files
if (process.env.NODE_ENV !== 'production') {
  const serveIndex = require('serve-index');
  app.use('/uploads', serveIndex(uploadDir, { icons: true, view: 'details' }));
}

// ─────────────────────────────────────────────
// META WHATSAPP CLOUD API WEBHOOK
// ─────────────────────────────────────────────

/**
 * GET /webhook — Meta verification handshake
 * Meta calls this once when you register the webhook URL in the portal.
 */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(`[WEBHOOK VERIFY] mode=${mode} token=${token}`);

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('[WEBHOOK VERIFY] ✅ Verified successfully');
    res.status(200).send(challenge);
  } else {
    console.warn('[WEBHOOK VERIFY] ❌ Token mismatch');
    res.sendStatus(403);
  }
});

/**
 * POST /webhook — Incoming messages from real WhatsApp users
 * Must respond 200 immediately; process async.
 */
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Always ack within 20s or Meta retries

  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!entry) return;

    // Which of our two WhatsApp numbers received this message?
    // Meta puts the phone_number_id of the *receiving* business number in
    // `metadata.phone_number_id`. This is the routing key for our two-line
    // setup (TECH vs SERVICE) — we pass it through to handleMessage so
    // replies go back from the same line.
    const receivedOnPhoneId = entry.metadata?.phone_number_id || null;
    const line = wa.lineFor(receivedOnPhoneId);

    // Handle incoming messages
    if (entry.messages && entry.messages.length > 0) {
      const msg = entry.messages[0];
      const phone = msg.from;

      // Dedup: skip if already processed
      const msgId = msg.id;
      const dedup = await db.query(
        `INSERT INTO wa_message_dedup (message_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING message_id`,
        [msgId]
      );
      if (dedup.rowCount === 0) {
        console.log(`[WEBHOOK] Duplicate message ${msgId} skipped`);
        return;
      }

      // Extract text from various message types
      let text = '';
      let mediaId = null;
      let handled = false;

      if (msg.type === 'text') {
        text = msg.text?.body || '';
      } else if (msg.type === 'interactive') {
        // Button reply
        text = msg.interactive?.button_reply?.id || msg.interactive?.button_reply?.title || '';
        // List reply
        if (!text) text = msg.interactive?.list_reply?.id || msg.interactive?.list_reply?.title || '';
        // Flow completion (nfm_reply)
        if (msg.interactive?.type === 'nfm_reply') {
          const responseJson = msg.interactive?.nfm_reply?.response_json;
          if (responseJson) {
            try {
              const flowData = JSON.parse(responseJson);
              console.log(`[WEBHOOK] From=${phone} line=${line} Type=flow_response`);
              webhook.handleMessage(phone, '[FLOW_RESPONSE]', null, flowData, null, line).catch(err =>
                console.error(`[WEBHOOK] Flow handler error for ${phone}:`, err.message)
              );
              handled = true;
            } catch (e) {
              console.error('[WEBHOOK] Failed to parse flow response JSON:', e.message);
            }
          }
        }
      } else if (msg.type === 'image') {
        text = '[MEDIA]';
        mediaId = msg.image?.id;
      } else if (msg.type === 'video') {
        text = '[MEDIA]';
        mediaId = msg.video?.id;
      } else if (msg.type === 'document') {
        text = '[MEDIA]';
        mediaId = msg.document?.id;
      } else if (msg.type === 'button') {
        text = msg.button?.text || msg.button?.payload || '';
      } else if (msg.type === 'location') {
        const loc = {
          latitude: msg.location?.latitude,
          longitude: msg.location?.longitude,
          name: msg.location?.name || null,
          address: msg.location?.address || null,
        };
        console.log(`[WEBHOOK] From=${phone} line=${line} Type=location lat=${loc.latitude} lng=${loc.longitude}`);
        webhook.handleMessage(phone, '[LOCATION]', null, null, loc, line).catch(err =>
          console.error(`[WEBHOOK] Location handler error for ${phone}:`, err.message)
        );
        handled = true;
      }

      if (!handled) {
        console.log(`[WEBHOOK] From=${phone} line=${line} Type=${msg.type} Text="${text}" MediaId=${mediaId}`);
        // Process asynchronously
        webhook.handleMessage(phone, text, mediaId, null, null, line).catch(err =>
          console.error(`[WEBHOOK] Handler error for ${phone}:`, err.message)
        );
      }
    }

    // Handle message status updates (delivered, read, failed)
    if (entry.statuses && entry.statuses.length > 0) {
      const status = entry.statuses[0];
      console.log(`[WEBHOOK STATUS] msgId=${status.id} status=${status.status} to=${status.recipient_id}`);
    }
  } catch (err) {
    console.error('[WEBHOOK] Processing error:', err.message);
  }
});

// ─────────────────────────────────────────────
// SIMULATOR ENDPOINTS
// ─────────────────────────────────────────────

/**
 * POST /api/simulate - Main simulator endpoint (simulates incoming WhatsApp message)
 */
app.post('/api/simulate', async (req, res) => {
  const { phone, message, media_url, line } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'phone and message required' });
  }

  // Simulator caller may specify which line (tech/service) to simulate;
  // default to service (customer-facing) if omitted.
  const simulatedLine = line || 'service';

  // Process the message asynchronously
  webhook.handleMessage(phone, message, media_url || null, null, null, simulatedLine)
    .catch(err => console.error('[WEBHOOK] Error:', err));

  res.json({ status: 'processing', phone, message, line: simulatedLine });
});

/**
 * GET /api/messages/:phone - Poll for outbound messages to this phone
 */
app.get('/api/messages/:phone', async (req, res) => {
  const messages = await wa.getPendingMessages(req.params.phone);
  res.json(messages);
});

/**
 * GET /api/messages/all/recent - All recent messages for admin
 */
app.get('/api/messages/all/recent', async (req, res) => {
  const messages = await wa.getAllRecentMessages(200);
  res.json(messages);
});

// ─────────────────────────────────────────────
// ADMIN AUTH ENDPOINTS  (public — must come BEFORE the guard)
// ─────────────────────────────────────────────
app.post('/api/admin/login', adminAuth.login);
app.post('/api/admin/logout', adminAuth.logout);
app.get('/api/admin/me', adminAuth.me);

// ─────────────────────────────────────────────
// ADMIN API ENDPOINTS  (all /api/admin/* below require auth)
// ─────────────────────────────────────────────
app.use('/api/admin', requireAdmin);

// Admin user management
app.get('/api/admin/users', adminAuth.listUsers);
app.post('/api/admin/users', adminAuth.createUser);
app.post('/api/admin/users/:id/deactivate', adminAuth.deactivateUser);
app.post('/api/admin/users/:id/reset-password', adminAuth.resetPassword);

app.get('/api/admin/stats', admin.getStats);
app.get('/api/admin/units', admin.getUnits);
app.get('/api/admin/units/:id', admin.getUnit);
app.post('/api/admin/units', admin.seedUnit);
app.get('/api/admin/jobs', admin.getJobs);
app.get('/api/admin/jobs/:id', admin.getJob);
app.post('/api/admin/jobs/:id/broadcast', admin.forceBroadcast);
app.post('/api/admin/jobs/:id/dispute', admin.resolveDispute);
app.get('/api/admin/technicians', admin.getTechnicians);
app.post('/api/admin/technicians/:id/approve', admin.approveTechnician);
app.get('/api/admin/zones', admin.getZones);
app.get('/api/admin/maintenance', admin.getMaintenanceSchedules);
app.get('/api/admin/ledger', admin.getLedger);
app.post('/api/admin/ledger/:techId/settle', admin.markSettled);
app.get('/api/admin/customers', admin.getCustomers);

// Manual trigger for maintenance cron (testing)
app.post('/api/admin/trigger/maintenance', async (req, res) => {
  const maintenanceFlow = require('./src/services/flows/maintenanceFlow');
  await maintenanceFlow.checkAndNotify();
  res.json({ message: 'Maintenance check triggered' });
});

// Manual trigger for broadcast cron (testing)
app.post('/api/admin/trigger/broadcast', async (req, res) => {
  const { broadcastJob } = require('./src/services/flows/installationFlow');
  const jobId = req.body.job_id;
  if (!jobId) return res.status(400).json({ error: 'job_id required' });

  const jobResult = await db.query(`SELECT * FROM jobs WHERE id = $1`, [jobId]);
  if (!jobResult.rows[0]) return res.status(404).json({ error: 'Job not found' });

  const job = jobResult.rows[0];
  await db.query(`UPDATE jobs SET status = 'broadcasting', updated_at = now() WHERE id = $1`, [jobId]);
  await broadcastJob(job, job.zone_id);
  res.json({ message: 'Broadcast triggered' });
});

// ─────────────────────────────────────────────
// REFERRAL REDIRECT
// ─────────────────────────────────────────────

/**
 * GET /ref/:code — Referral link clicked by prospective technician.
 * Redirects to WhatsApp with pre-filled registration message.
 */
app.get('/ref/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const waPhone = process.env.WA_BUSINESS_PHONE || '918888888888'; // your WhatsApp business number
  const text = encodeURIComponent(`REGISTER TECH REF_${code}`);
  res.redirect(`https://wa.me/${waPhone}?text=${text}`);
});

// Admin: view referral scheme
app.get('/api/admin/referral/scheme', async (req, res) => {
  const referralFlow = require('./src/services/flows/referralFlow');
  const scheme = await referralFlow.getActiveScheme();
  res.json(scheme);
});

// Admin: update referral scheme
app.post('/api/admin/referral/scheme', async (req, res) => {
  const { jobs_threshold, reward_rs, notes } = req.body;
  if (!jobs_threshold || !reward_rs) {
    return res.status(400).json({ error: 'jobs_threshold and reward_rs required' });
  }
  const referralFlow = require('./src/services/flows/referralFlow');
  const scheme = await referralFlow.updateScheme(parseInt(jobs_threshold), parseFloat(reward_rs), notes);
  res.json({ message: 'Scheme updated', scheme });
});

// Admin: view all referrals
app.get('/api/admin/referrals', async (req, res) => {
  const result = await db.query(`
    SELECT r.*,
           t1.name AS referrer_name, t1.phone AS referrer_phone,
           t2.name AS referred_name, t2.phone AS referred_phone,
           rs.jobs_threshold, rs.reward_paise
    FROM referrals r
    JOIN technicians t1 ON t1.id = r.referrer_id
    LEFT JOIN technicians t2 ON t2.id = r.referred_id
    JOIN referral_schemes rs ON rs.id = r.scheme_id
    ORDER BY r.created_at DESC
  `);
  res.json(result.rows);
});

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date() });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// ─────────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message, err.stack);
  res.status(500).json({ error: err.message });
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
async function start() {
  // Wait for DB
  let retries = 10;
  while (retries > 0) {
    try {
      await db.query('SELECT 1');
      console.log('[DB] Connected successfully');
      break;
    } catch (err) {
      console.log(`[DB] Connection failed, retrying... (${retries} left)`);
      retries--;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Seed default admin user if admin_users is empty (idempotent)
  await adminAuth.ensureDefaultAdmin();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Knite Backend running on http://localhost:${PORT}`);
    console.log(`📱 Simulator: http://localhost:${PORT}/simulator.html`);
    console.log(`🔧 Admin:     http://localhost:${PORT}/admin.html`);
    console.log(`❤️  Health:   http://localhost:${PORT}/api/health\n`);
  });

  // Start background cron jobs
  crons.startAll();
}

start().catch(console.error);
