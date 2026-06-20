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
const shop  = require('./src/controllers/shopController');
const shopAuth = require('./src/controllers/shopAuthController');
const reviews = require('./src/controllers/reviewsController');
const payment = require('./src/controllers/paymentController');
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

// Attach req.shopCustomer if a valid shop session cookie is present
app.use((req, res, next) => shopAuth.attachShopCustomer(req, res, next));

// ─────────────────────────────────────────────
// WHATSAPP FLOW DATA EXCHANGE ENDPOINT
// Must be registered BEFORE express.json() so we receive the raw
// encrypted binary body that Meta sends.
// ─────────────────────────────────────────────
app.get('/api/flow-exchange', (req, res) => res.json({ data: { status: 'active' } }));
app.post('/api/flow-exchange', express.json(), handleFlowExchange);

// JSON body parser — also capture raw body for webhook signature verification
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); },
}));

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
      const errInfo = status.errors?.length
        ? ` errors=${JSON.stringify(status.errors)}`
        : '';
      console.log(`[WEBHOOK STATUS] msgId=${status.id} status=${status.status} to=${status.recipient_id}${errInfo}`);

      // Any delivery failure — mark the offer with the exact Meta error
      if (status.status === 'failed' && status.errors?.length) {
        try {
          const metaErr = status.errors[0];
          const code = metaErr.code;
          const detail = metaErr.error_data?.details || metaErr.message || metaErr.title || 'Unknown delivery error';
          const failureReason = `[Meta error ${code}] ${detail}`;
          const newStatus = code === 131047 ? 'window_expired' : 'delivery_failed';

          const updated = await db.query(
            `UPDATE manual_allotment_offers
             SET status=$1, failure_reason=$2
             WHERE wa_message_id=$3 AND status='pending'
             RETURNING id`,
            [newStatus, failureReason, status.id]
          );
          if (updated.rowCount > 0) {
            console.log(`[MANUAL ALLOTMENT] Offer msgId=${status.id} → ${newStatus}: ${failureReason}`);
          }
        } catch (e) {
          console.error('[MANUAL ALLOTMENT] Failed to update offer status:', e.message);
        }
      }
    }
  } catch (err) {
    console.error('[WEBHOOK] Processing error:', err.message);
  }
});

// ─────────────────────────────────────────────
// WEBSITE PUBLIC ENDPOINTS  (no auth required)
// ─────────────────────────────────────────────

/**
 * POST /api/website/lead — Submit feedback / enquiry form from the website
 */
app.post('/api/website/lead', async (req, res) => {
  const { name, phone, email, enquiry_type, city, rating, message } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!phone || !phone.trim()) return res.status(400).json({ error: 'Phone is required' });
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });

  // Normalise phone — strip spaces/dashes/+
  const normPhone = phone.replace(/[^0-9]/g, '');

  const result = await db.query(
    `INSERT INTO website_leads (name, phone, email, enquiry_type, city, rating, message, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'website')
     RETURNING id, created_at`,
    [
      name.trim(),
      normPhone,
      email?.trim() || null,
      enquiry_type?.trim() || null,
      city?.trim() || null,
      rating ? parseInt(rating) : null,
      message.trim(),
    ]
  );

  const lead = result.rows[0];
  console.log(`[WEBSITE LEAD] id=${lead.id} name=${name} phone=${normPhone} type=${enquiry_type || '–'}`);

  res.json({ ok: true, id: lead.id });
});

// ─────────────────────────────────────────────
// SHOP / E-COMMERCE — public endpoints (no auth)
// ─────────────────────────────────────────────
app.get('/api/shop/products',          shop.listProducts);
app.get('/api/shop/products/:slug',    shop.getProduct);

// Reviews — public list + eligibility check + create (requires login + delivered purchase)
app.get ('/api/shop/products/:slug/reviews',            reviews.listReviews);
app.get ('/api/shop/products/:slug/review-eligibility', reviews.getEligibility);
app.post('/api/shop/products/:slug/reviews',            shopAuth.requireShopCustomer, reviews.createReview);
app.post('/api/shop/cart/validate',    shop.validateCart);
app.post('/api/shop/orders',           shopAuth.requireShopCustomer, shop.placeOrder);
app.get('/api/shop/orders/:id',        shop.getOrderForCustomer);

// Payments (Cashfree)
app.post('/api/shop/payment/create-order', shopAuth.requireShopCustomer, payment.createOrder);
app.post('/api/shop/payment/verify',       shopAuth.requireShopCustomer, payment.verifyPayment);
app.post('/api/webhooks/cashfree',         payment.cashfreeWebhook);

// Shop customer auth — OTP via WhatsApp
app.post('/api/shop/auth/send-otp',    shopAuth.sendOtp);
app.post('/api/shop/auth/verify-otp',  shopAuth.verifyOtp);
app.post('/api/shop/auth/logout',      shopAuth.logout);
app.get ('/api/shop/me',               shopAuth.me);

// Shop customer protected endpoints — require logged-in session
app.patch('/api/shop/me',              shopAuth.requireShopCustomer, shopAuth.updateMe);
app.get ('/api/shop/my-orders',        shopAuth.requireShopCustomer, shopAuth.myOrders);
app.get ('/api/shop/my-orders/:id/invoice', shopAuth.requireShopCustomer, shopAuth.myOrderInvoice);
app.get ('/api/shop/my-addresses',     shopAuth.requireShopCustomer, shopAuth.listAddresses);
app.post('/api/shop/my-addresses',     shopAuth.requireShopCustomer, shopAuth.addAddress);
app.delete('/api/shop/my-addresses/:id', shopAuth.requireShopCustomer, shopAuth.deleteAddress);

/**
 * GET /api/admin/website-leads — View all website enquiries (admin only)
 */
app.get('/api/admin/website-leads', requireAdmin, async (req, res) => {
  const { status, limit = 100 } = req.query;
  const where = status ? `WHERE status = $1` : '';
  const params = status ? [status] : [];
  const r = await db.query(
    `SELECT * FROM website_leads ${where} ORDER BY created_at DESC LIMIT ${parseInt(limit)}`,
    params
  );
  res.json(r.rows);
});

/**
 * PATCH /api/admin/website-leads/:id — Update lead status (new → contacted → converted)
 */
app.patch('/api/admin/website-leads/:id', requireAdmin, async (req, res) => {
  const { status, notes } = req.body;
  await db.query(
    `UPDATE website_leads SET status = COALESCE($1, status), notes = COALESCE($2, notes) WHERE id = $3`,
    [status || null, notes || null, req.params.id]
  );
  res.json({ ok: true });
});

/**
 * POST /api/admin/refresh-coverage — Regenerate /coverage-data.json from ro_service_leads.
 * Used by the "Refresh Coverage Map" button on the admin panel.
 */
app.post('/api/admin/refresh-coverage', requireAdmin, async (req, res) => {
  try {
    const cities = await db.query(`
      SELECT
        city,
        state,
        ROUND(AVG(latitude)::numeric, 4)::float  AS lat,
        ROUND(AVG(longitude)::numeric, 4)::float AS lng,
        COUNT(*)::int AS count
      FROM ro_service_leads
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND city IS NOT NULL AND city != ''
        AND state IS NOT NULL AND state != ''
        AND latitude BETWEEN 6 AND 38
        AND longitude BETWEEN 67 AND 98
      GROUP BY city, state
      ORDER BY COUNT(*) DESC
    `);
    const stats = await db.query(`
      SELECT COUNT(DISTINCT city)::int    AS cities,
             COUNT(DISTINCT state)::int   AS states,
             COUNT(DISTINCT pincode)::int AS pincodes,
             COUNT(*)::int                AS total
      FROM ro_service_leads WHERE latitude IS NOT NULL
    `);

    const payload = {
      generated_at: new Date().toISOString(),
      stats: stats.rows[0],
      cities: cities.rows,
    };

    const fs = require('fs');
    const path = require('path');
    const target = path.join(frontendPath, 'coverage-data.json');
    fs.writeFileSync(target, JSON.stringify(payload));

    console.log(`[COVERAGE] refreshed: ${cities.rows.length} cities, ${stats.rows[0].total} partners → ${target}`);
    res.json({ ok: true, ...payload.stats, cities_written: cities.rows.length, generated_at: payload.generated_at });
  } catch (err) {
    console.error('[COVERAGE] refresh failed:', err);
    res.status(500).json({ ok: false, error: err.message });
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
app.get('/api/admin/jobs/:id/suggestions', admin.getJobSuggestions);
app.post('/api/admin/jobs/:id/send-offer', admin.sendManualOffer);
app.get('/api/admin/jobs/:id/offers', admin.getJobOffers);
app.patch('/api/admin/leads/:id', admin.updateLeadContact);
app.post('/api/admin/jobs/:id/broadcast', admin.forceBroadcast);
app.post('/api/admin/jobs/:id/dispute', admin.resolveDispute);
app.get('/api/admin/technicians', admin.getTechnicians);
app.post('/api/admin/technicians/:id/approve', admin.approveTechnician);
app.get('/api/admin/zones', admin.getZones);
app.get('/api/admin/maintenance', admin.getMaintenanceSchedules);
app.get('/api/admin/ledger', admin.getLedger);
app.post('/api/admin/ledger/:techId/settle', admin.markSettled);
app.get('/api/admin/customers', admin.getCustomers);

// Shop admin endpoints
app.get('/api/admin/shop/products',         shop.adminListProducts);
app.patch('/api/admin/shop/products/:id',   shop.adminUpdateProduct);
app.get('/api/admin/shop/orders',           shop.adminListOrders);
app.get('/api/admin/shop/orders/:id',       shop.adminGetOrder);
app.patch('/api/admin/shop/orders/:id',     shop.adminUpdateOrder);

// Manually regenerate + resend invoice for an order (admin tool)
app.post('/api/admin/shop/orders/:id/invoice', async (req, res) => {
  try {
    const invoiceGen = require('./src/services/invoiceGenerator');
    const wa = require('./src/services/whatsappService');
    const db = require('./src/db');

    const oR = await db.query(`SELECT * FROM shop_orders WHERE id = $1`, [req.params.id]);
    if (!oR.rows.length) return res.status(404).json({ error: 'Order not found' });
    const o = oR.rows[0];

    const inv = await invoiceGen.generateInvoiceForOrder(o.id);

    // Optional: skip WhatsApp if ?send=0
    if (req.query.send !== '0') {
      await wa.sendDocument(
        '91' + o.customer_phone,
        inv.file_path,
        {
          filename: `Knite-Invoice-${o.order_number}.pdf`,
          caption: `📄 *Tax Invoice — ${inv.invoice_number}*\n\nYour GST invoice for order ${o.order_number} is attached.\n\n— Team Knite`,
          fallbackUrl: inv.invoice_url,
        },
        { line: 'service' }
      );
      await db.query(`UPDATE shop_orders SET invoice_sent_at = NOW() WHERE id = $1`, [o.id]);
    }

    res.json({ ok: true, ...inv });
  } catch (err) {
    console.error('[ADMIN invoice gen] failed:', err);
    res.status(500).json({ error: err.message });
  }
});

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
// 404 — serve custom 404.html for unknown HTML routes (good SEO)
// ─────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  // Send the custom 404 page with proper 404 status
  res.status(404).sendFile(path.join(frontendPath, '404.html'), (err) => {
    if (err) res.status(404).send('Not Found');
  });
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

  // Lightweight idempotent schema migrations for columns added after the
  // initial schema.sql bootstrap. schema.sql is only loaded on empty DBs;
  // this keeps long-running RDS instances in sync with new columns.
  try {
    await db.query(`ALTER TABLE technicians ADD COLUMN IF NOT EXISTS kyc_doc_back_url TEXT`);
  } catch (err) {
    console.error('[SCHEMA_MIGRATE] kyc_doc_back_url:', err.message);
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
