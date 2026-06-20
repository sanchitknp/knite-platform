// ─────────────────────────────────────────────────────────────
// Cashfree Payment Gateway service — Knite
// Uses Cashfree PG v2025-01-01 API (raw fetch — no SDK needed)
// Env vars required:
//   CASHFREE_APP_ID         (e.g. TEST110920013ea096a34b899d5b388610029011)
//   CASHFREE_SECRET_KEY     (cfsk_ma_test_...)
//   CASHFREE_WEBHOOK_SECRET (revealed after creating webhook in dashboard)
//   CASHFREE_MODE           "sandbox" (test) | "production"   default sandbox
// ─────────────────────────────────────────────────────────────
const crypto = require('crypto');

const MODE          = (process.env.CASHFREE_MODE || 'sandbox').toLowerCase();
const APP_ID        = process.env.CASHFREE_APP_ID || '';
const SECRET_KEY    = process.env.CASHFREE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.CASHFREE_WEBHOOK_SECRET || '';

const BASE = MODE === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

const API_VERSION = '2025-01-01';

function isConfigured() {
  return !!(APP_ID && SECRET_KEY);
}

function authHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-api-version': API_VERSION,
    'x-client-id': APP_ID,
    'x-client-secret': SECRET_KEY,
    ...extra,
  };
}

/**
 * Create a Cashfree order.
 * @param {object} args
 * @param {string} args.orderId        Unique order id (our internal order #)
 * @param {number} args.amount         INR amount (rupees, will be sent as decimal)
 * @param {object} args.customer       { id, name, email, phone }
 * @param {string} args.returnUrl      URL to redirect back to after payment
 * @returns {Promise<{order_id,payment_session_id,order_status,...}>}
 */
async function createOrder({ orderId, amount, customer, returnUrl, note }) {
  if (!isConfigured()) throw new Error('Cashfree not configured (missing CASHFREE_APP_ID / CASHFREE_SECRET_KEY)');
  if (!orderId || !amount || amount <= 0) throw new Error('Invalid order details');

  // Cashfree requires customer_id (alphanumeric, 1–50 chars)
  const cid = String(customer?.id || 'guest_' + Date.now()).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 50);
  const phone = String(customer?.phone || '').replace(/[^0-9]/g, '').slice(-10);
  if (!/^\d{10}$/.test(phone)) throw new Error('Customer phone must be 10 digits');

  const body = {
    order_id: orderId,
    order_amount: Number(amount).toFixed(2),
    order_currency: 'INR',
    customer_details: {
      customer_id: cid,
      customer_phone: phone,
      customer_email: customer?.email || undefined,
      customer_name: customer?.name || undefined,
    },
    order_note: note || `Knite order ${orderId}`,
    order_meta: {
      return_url: returnUrl,
      notify_url: 'https://knite.in/api/webhooks/cashfree',
    },
  };

  const r = await fetch(`${BASE}/orders`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    console.error('[CASHFREE] createOrder failed:', r.status, data);
    throw new Error(data?.message || data?.error || 'Cashfree create-order failed');
  }
  return data;
}

/** GET payment / order status from Cashfree (server-side verification) */
async function getOrder(orderId) {
  if (!isConfigured()) throw new Error('Cashfree not configured');
  const r = await fetch(`${BASE}/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || 'Cashfree get-order failed');
  return data;
}

async function getOrderPayments(orderId) {
  if (!isConfigured()) throw new Error('Cashfree not configured');
  const r = await fetch(`${BASE}/orders/${encodeURIComponent(orderId)}/payments`, {
    method: 'GET',
    headers: authHeaders(),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || 'Cashfree get-payments failed');
  return data;
}

/** Initiate refund for a captured payment */
async function refundOrder({ orderId, refundAmount, refundId, note }) {
  if (!isConfigured()) throw new Error('Cashfree not configured');
  const body = {
    refund_amount: Number(refundAmount).toFixed(2),
    refund_id: refundId || `rf_${orderId}_${Date.now()}`,
    refund_note: note || 'Customer requested refund',
  };
  const r = await fetch(`${BASE}/orders/${encodeURIComponent(orderId)}/refunds`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || 'Cashfree refund failed');
  return data;
}

/**
 * Verify webhook signature.
 * Cashfree sends:
 *   x-webhook-timestamp
 *   x-webhook-signature
 * Signature is base64(HMAC_SHA256(timestamp + rawBody, WEBHOOK_SECRET))
 */
function verifyWebhookSignature(rawBody, timestamp, signature) {
  if (!WEBHOOK_SECRET) {
    console.warn('[CASHFREE] CASHFREE_WEBHOOK_SECRET not set — skipping signature verification (UNSAFE)');
    return true; // dev fallback; never deploy live without WEBHOOK_SECRET
  }
  const data = String(timestamp) + (Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(data).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
  } catch {
    return false;
  }
}

module.exports = {
  isConfigured,
  MODE,
  createOrder,
  getOrder,
  getOrderPayments,
  refundOrder,
  verifyWebhookSignature,
};
