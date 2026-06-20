// ─────────────────────────────────────────────────────────────
// Payment controller — Cashfree integration
// Endpoints:
//   POST /api/shop/payment/create-order  (auth required, expects {order_id})
//   POST /api/shop/payment/verify        (auth required, expects {cf_order_id})
//   POST /api/webhooks/cashfree          (raw body, signature-verified)
// ─────────────────────────────────────────────────────────────
const { pool } = require('../db');
const cf       = require('../services/cashfreeService');
const wa       = require('../services/whatsappService');
const invoiceGen = require('../services/invoiceGenerator');

// Generate the customer-facing return URL after they finish payment on Cashfree's page
function returnUrlFor(orderRow, customer) {
  const phone = String(customer?.phone || '').replace(/[^0-9]/g, '').slice(-10);
  // Order tracking page; we'll verify status server-side again when this loads
  return `https://knite.in/order.html?id=${orderRow.id}&phone=${phone}&pay=1`;
}

// POST /api/shop/payment/create-order   { order_id }   (uses shop_orders.id)
async function createOrder(req, res) {
  try {
    if (!cf.isConfigured()) {
      return res.status(503).json({ error: 'Payments temporarily unavailable. Please use Cash on Delivery.' });
    }
    const customer = req.shopCustomer;
    if (!customer) return res.status(401).json({ error: 'Login required' });

    const orderId = parseInt(req.body.order_id, 10);
    if (!orderId) return res.status(400).json({ error: 'order_id required' });

    const oR = await pool.query(
      `SELECT id, order_number, total_amount, customer_id, payment_status, payment_method
       FROM shop_orders WHERE id = $1 AND customer_id = $2 LIMIT 1`,
      [orderId, customer.id]
    );
    if (!oR.rows.length) return res.status(404).json({ error: 'Order not found' });
    const order = oR.rows[0];

    if (order.payment_status === 'paid') {
      return res.status(409).json({ error: 'Order already paid' });
    }

    // Cashfree wants a unique order_id; use our order_number (also short-circuit if we already created one)
    const cfOrderId = order.order_number;

    const cfOrder = await cf.createOrder({
      orderId: cfOrderId,
      amount: Number(order.total_amount),
      customer: {
        id: 'cust_' + customer.id,
        name: customer.name || 'Knite Customer',
        email: customer.email || `customer${customer.id}@knite.in`,
        phone: customer.phone,
      },
      returnUrl: returnUrlFor(order, customer),
      note: `Knite order ${order.order_number}`,
    });

    await pool.query(
      `UPDATE shop_orders
       SET cashfree_order_id = $1, payment_method = 'online', payment_status = 'pending'
       WHERE id = $2`,
      [cfOrder.cf_order_id || cfOrderId, order.id]
    );

    await pool.query(
      `INSERT INTO payment_events (order_id, cashfree_order_id, event_type, source, raw_payload)
       VALUES ($1, $2, 'ORDER_CREATED', 'create', $3)`,
      [order.id, cfOrderId, JSON.stringify(cfOrder)]
    );

    res.json({
      ok: true,
      order_id: order.id,
      cf_order_id: cfOrderId,
      payment_session_id: cfOrder.payment_session_id,
      mode: cf.MODE,
      amount: Number(order.total_amount),
    });
  } catch (err) {
    console.error('[PAYMENT] createOrder:', err);
    res.status(500).json({ error: err.message || 'Could not create payment order' });
  }
}

// POST /api/shop/payment/verify   { order_id }   — server-side verification after redirect
async function verifyPayment(req, res) {
  try {
    if (!cf.isConfigured()) return res.status(503).json({ error: 'Payments unavailable' });
    const customer = req.shopCustomer;
    if (!customer) return res.status(401).json({ error: 'Login required' });

    const orderId = parseInt(req.body.order_id, 10);
    if (!orderId) return res.status(400).json({ error: 'order_id required' });

    const oR = await pool.query(
      `SELECT id, order_number, cashfree_order_id, payment_status, customer_id
       FROM shop_orders WHERE id = $1 AND customer_id = $2`,
      [orderId, customer.id]
    );
    if (!oR.rows.length) return res.status(404).json({ error: 'Order not found' });
    const order = oR.rows[0];

    if (order.payment_status === 'paid') {
      return res.json({ ok: true, payment_status: 'paid' });
    }

    const cfOrderId = order.cashfree_order_id || order.order_number;
    const cfData = await cf.getOrder(cfOrderId);
    // cfData.order_status is "PAID" | "ACTIVE" | "EXPIRED"

    let newStatus = order.payment_status;
    if (cfData.order_status === 'PAID') {
      newStatus = 'paid';
      await markPaid(order.id, cfData, 'verify');
    } else if (cfData.order_status === 'EXPIRED') {
      newStatus = 'failed';
      await pool.query(`UPDATE shop_orders SET payment_status = 'failed' WHERE id = $1`, [order.id]);
    }

    res.json({ ok: true, payment_status: newStatus, cashfree_status: cfData.order_status });
  } catch (err) {
    console.error('[PAYMENT] verify:', err);
    res.status(500).json({ error: err.message || 'Verification failed' });
  }
}

// Helper — marks order paid + triggers WA confirmation + invoice (idempotent)
async function markPaid(orderId, cfData, source) {
  const r = await pool.query(
    `UPDATE shop_orders
     SET payment_status = 'paid',
         paid_at = COALESCE(paid_at, NOW()),
         cashfree_payment_id = COALESCE(cashfree_payment_id, $2),
         status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END
     WHERE id = $1 AND payment_status != 'paid'
     RETURNING id, order_number, customer_id, total_amount`,
    [orderId, cfData?.cf_order_id || cfData?.cf_payment_id || null]
  );
  if (!r.rows.length) return false; // already paid

  await pool.query(
    `INSERT INTO payment_events (order_id, cashfree_order_id, event_type, source, raw_payload, signature_ok)
     VALUES ($1, $2, 'PAYMENT_SUCCESS', $3, $4, TRUE)`,
    [orderId, cfData?.order_id || null, source, JSON.stringify(cfData)]
  );

  // Fire WhatsApp confirmation + invoice (async, don't block)
  setImmediate(async () => {
    try {
      const orderRow = r.rows[0];
      const c = await pool.query(`SELECT phone, name FROM shop_customers WHERE id = $1`, [orderRow.customer_id]);
      const phone = c.rows[0]?.phone;
      const name  = c.rows[0]?.name || 'Customer';
      if (phone) {
        await wa.sendText('91' + phone,
          `✅ *Payment received — thank you, ${name}!*\n\n` +
          `Order *${orderRow.order_number}* — ₹${Number(orderRow.total_amount).toLocaleString('en-IN')}\n\n` +
          `Your Knite RO will ship in 2-3 days. Track it any time at https://knite.in/order.html?id=${orderRow.id}`,
          { line: 'tech' }
        );
      }
    } catch (e) { console.error('[PAYMENT] WA notify failed:', e.message); }
  });
  return true;
}

// POST /api/webhooks/cashfree   (raw body)
async function cashfreeWebhook(req, res) {
  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const sigOk = cf.verifyWebhookSignature(rawBody, timestamp, signature);

    const event = req.body || {};
    const type  = event.type || event.event_type || 'UNKNOWN';
    const data  = event.data || {};
    const cfOrderId    = data.order?.order_id || data.payment?.order_id || null;
    const cfPaymentId  = data.payment?.cf_payment_id || null;

    await pool.query(
      `INSERT INTO payment_events (cashfree_order_id, cashfree_payment_id, event_type, source, raw_payload, signature_ok)
       VALUES ($1, $2, $3, 'webhook', $4, $5)`,
      [cfOrderId, cfPaymentId, type, JSON.stringify(event), sigOk]
    );

    if (!sigOk) {
      console.warn('[CASHFREE WEBHOOK] signature invalid for', type, cfOrderId);
      // Still return 200 so Cashfree doesn't retry forever; we logged it
      return res.status(200).json({ received: true, signature: false });
    }

    if (!cfOrderId) return res.status(200).json({ received: true });

    // Find our order
    const oR = await pool.query(
      `SELECT id FROM shop_orders
       WHERE cashfree_order_id = $1 OR order_number = $1 LIMIT 1`,
      [cfOrderId]
    );
    if (!oR.rows.length) {
      console.warn('[CASHFREE WEBHOOK] unknown order', cfOrderId);
      return res.status(200).json({ received: true });
    }
    const orderId = oR.rows[0].id;

    if (type === 'PAYMENT_SUCCESS_WEBHOOK' || type === 'PAYMENT_SUCCESS') {
      await markPaid(orderId, { ...data.payment, order_id: cfOrderId }, 'webhook');
    } else if (type === 'PAYMENT_FAILED_WEBHOOK' || type === 'PAYMENT_USER_DROPPED_WEBHOOK') {
      await pool.query(
        `UPDATE shop_orders SET payment_status = 'failed' WHERE id = $1 AND payment_status != 'paid'`,
        [orderId]
      );
    } else if (type === 'REFUND_STATUS_WEBHOOK') {
      const refundAmount = Number(data.refund?.refund_amount || 0);
      const status       = data.refund?.refund_status; // SUCCESS / PENDING / FAILED
      if (status === 'SUCCESS') {
        await pool.query(
          `UPDATE shop_orders
           SET refund_amount = COALESCE(refund_amount,0) + $1,
               refunded_at   = NOW(),
               payment_status = CASE WHEN COALESCE(refund_amount,0) + $1 >= total_amount THEN 'refunded' ELSE payment_status END
           WHERE id = $2`,
          [refundAmount, orderId]
        );
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[CASHFREE WEBHOOK] error:', err);
    res.status(200).json({ received: true, error: err.message }); // never 5xx to webhook
  }
}

module.exports = { createOrder, verifyPayment, cashfreeWebhook };
