// Seller Service Portal — standalone Express app.
// Runs in its own container on the same VM as Knite, talks to the same Cloud SQL
// (as the `ssp` user), and serves its own static UI. Knite is untouched.
require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const path = require('path');

const { migrate } = require('./migrate');
const { requireAuth } = require('./auth');
const roles = require('./roles');
const { requirePerm } = roles;
const intake = require('./intake');
const authC = require('./controllers/authController');
const dashC = require('./controllers/dashboardController');
const teamC = require('./controllers/teamController');
const rolesC = require('./controllers/rolesController');
const ticketsC = require('./controllers/ticketsController');
const listingsC = require('./controllers/listingsController');
const safetyC = require('./controllers/safetyClaimsController');
const publicC = require('./controllers/publicController');
const installC = require('./controllers/installationsController');
const reviewsC = require('./controllers/reviewsController');
const productsC = require('./controllers/productsController');

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);

app.use(cors());
app.use(morgan('dev'));
app.use(cookieParser());
app.use(express.json({ limit: '20mb' }));   // base64 images for safety claims

// ── Health ───────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const db = require('./db');
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', service: 'seller-service-portal', time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: 'error', db: 'disconnected', message: e.message });
  }
});

// ── Public auth ──────────────────────────────────────────────
app.post('/api/auth/signup', authC.signup);
app.post('/api/auth/login', authC.login);
app.post('/api/auth/logout', authC.logout);

// ── Public intake (NO auth) — customer-facing request forms ──
app.get('/api/public/:token', publicC.info);
app.get('/api/public/:token/products', publicC.products);
app.post('/api/public/:token/support', publicC.submitSupport);
app.post('/api/public/:token/install', publicC.submitInstall);

// ── Everything below requires a logged-in seller ─────────────
app.use('/api', requireAuth);

app.get('/api/auth/me', authC.me);
app.get('/api/dashboard', dashC.summary);

// Team / RBAC (owner + admin)
app.get('/api/team', requirePerm('team.manage'), teamC.list);
app.post('/api/team', requirePerm('team.manage'), teamC.create);
app.patch('/api/team/:id', requirePerm('team.manage'), teamC.update);
app.post('/api/team/:id/reset-password', requirePerm('team.manage'), teamC.resetPassword);

// Roles & permissions
app.get('/api/roles', requirePerm('team.manage'), rolesC.list);
app.post('/api/roles', requirePerm('team.manage'), rolesC.create);
app.patch('/api/roles/:key', requirePerm('team.manage'), rolesC.update);
app.delete('/api/roles/:key', requirePerm('team.manage'), rolesC.remove);

// Settings
app.get('/api/marketplaces', requirePerm('settings.manage'), authC.listMarketplaces);
app.post('/api/marketplaces', requirePerm('settings.manage'), authC.addMarketplace);
app.get('/api/intake-links', authC.intakeLinks);
app.post('/api/intake-links/regenerate', requirePerm('settings.manage'), authC.regenerateIntakeToken);

// Installations
app.get('/api/installations', requirePerm('installations.read'), installC.list);
app.post('/api/installations', requirePerm('installations.write'), installC.create);
app.patch('/api/installations/:id', requirePerm('installations.write'), installC.update);
app.get('/api/installations/:id/nearest-technicians', requirePerm('installations.read'), installC.nearest);
app.post('/api/installations/:id/assign', requirePerm('installations.write'), installC.assign);
app.post('/api/installations/:id/review-request', requirePerm('installations.write'), installC.reviewRequest);

// Products (catalog) — read for any staff; manage gated by settings.manage
app.get('/api/products', productsC.list);
app.post('/api/products', requirePerm('settings.manage'), productsC.create);
app.patch('/api/products/:id', requirePerm('settings.manage'), productsC.update);
app.delete('/api/products/:id', requirePerm('settings.manage'), productsC.remove);

// Ratings & reviews
app.get('/api/reviews', requirePerm('reviews.read'), reviewsC.list);
app.post('/api/reviews', requirePerm('reviews.write'), reviewsC.create);
app.patch('/api/reviews/:id', requirePerm('reviews.write'), reviewsC.update);
app.delete('/api/reviews/:id', requirePerm('reviews.write'), reviewsC.remove);

// Sales & Support
app.get('/api/tickets', requirePerm('support.read'), ticketsC.list);
app.post('/api/tickets', requirePerm('support.write'), ticketsC.create);
app.get('/api/tickets/:id', requirePerm('support.read'), ticketsC.get);
app.patch('/api/tickets/:id', requirePerm('support.write'), ticketsC.update);
app.post('/api/tickets/:id/messages', requirePerm('support.write'), ticketsC.addMessage);

// Listings
app.get('/api/listings', requirePerm('listings.read'), listingsC.list);
app.post('/api/listings', requirePerm('listings.write'), listingsC.create);
app.patch('/api/listings/:id', requirePerm('listings.write'), listingsC.update);
app.delete('/api/listings/:id', requirePerm('listings.write'), listingsC.remove);

// Safety Claims
app.get('/api/safety-claims', requirePerm('safety.read'), safetyC.listClaims);
app.post('/api/safety-claims', requirePerm('safety.write'), safetyC.createClaim);
app.post('/api/safety-claims/:orderId/images', requirePerm('safety.write'), safetyC.uploadImage);
app.get('/api/safety-claims/:orderId/images', requirePerm('safety.read'), safetyC.listImages);
app.get('/api/safety-claims/:orderId/image/:name', requirePerm('safety.read'), safetyC.getImage);
app.post('/api/safety-claims/:orderId/file', requirePerm('safety.write'), safetyC.markFiled);
app.patch('/api/safety-claims/:orderId', requirePerm('safety.write'), safetyC.renameClaim);
app.delete('/api/safety-claims/:orderId', requirePerm('safety.write'), safetyC.deleteClaim);

// ── Static UI (served last so /api/* wins) ───────────────────
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));
// Public customer-facing request forms (served without auth).
app.get('/r/:token/:type?', (req, res) => res.sendFile(path.join(publicDir, 'intake.html')));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// ── Error handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERR]', err.message);
  res.status(err.status || 500).json({ error: 'server_error', message: err.message });
});

// ── Boot ─────────────────────────────────────────────────────
(async () => {
  try {
    await migrate();
    await roles.backfillRoles();   // seed default roles for any seller missing them
    await intake.backfillTokens(); // give public intake tokens to pre-existing sellers
  } catch (e) {
    console.error('[BOOT] migration failed:', e.message);
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SSP] Seller Service Portal listening on :${PORT}`);
  });
  // Safety-claim image retention: run on boot + daily.
  safetyC.cleanupExpired();
  cron.schedule('0 3 * * *', () => safetyC.cleanupExpired());
})();
