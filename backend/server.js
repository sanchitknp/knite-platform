require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const db = require('./src/db');
const webhook = require('./src/controllers/webhookController');
const admin = require('./src/controllers/adminController');
const wa = require('./src/services/whatsappService');
const crons = require('./src/jobs/cronJobs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

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

      if (msg.type === 'text') {
        text = msg.text?.body || '';
      } else if (msg.type === 'interactive') {
        // Button reply
        text = msg.interactive?.button_reply?.id || msg.interactive?.button_reply?.title || '';
        // List reply
        if (!text) text = msg.interactive?.list_reply?.id || msg.interactive?.list_reply?.title || '';
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
      }

      console.log(`[WEBHOOK] From=${phone} Type=${msg.type} Text="${text}" MediaId=${mediaId}`);

      // Process asynchronously
      webhook.handleMessage(phone, text, mediaId).catch(err =>
        console.error(`[WEBHOOK] Handler error for ${phone}:`, err.message)
      );
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
  const { phone, message, media_url } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'phone and message required' });
  }

  // Process the message asynchronously
  webhook.handleMessage(phone, message, media_url || null)
    .catch(err => console.error('[WEBHOOK] Error:', err));

  res.json({ status: 'processing', phone, message });
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
// ADMIN API ENDPOINTS
// ─────────────────────────────────────────────
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
