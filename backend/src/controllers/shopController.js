/**
 * Knite Shop controller — products, cart server-validation, orders.
 * Designed for guest checkout (no login required).
 */
const db = require('../db');
const wa = require('../services/whatsappService');
const invoiceGen = require('../services/invoiceGenerator');

const GST_RATE = 18;          // % default
const FREE_SHIPPING_OVER = 0;  // ₹0 = free shipping for everyone (no surprises at checkout)
const FLAT_SHIPPING = 0;       // ₹0 — included in price for now

// ─────────────────────────────────────────────────────────
// PUBLIC: Products
// ─────────────────────────────────────────────────────────

/** GET /api/shop/products — list active products, public */
async function listProducts(req, res) {
  try {
    const { featured } = req.query;
    const filter = featured === '1' ? 'AND is_featured = TRUE' : '';
    const r = await db.query(
      `SELECT p.id, p.slug, p.sku, p.name, p.short_desc, p.brand, p.category,
              p.mrp, p.selling_price, p.gst_rate, p.capacity_litres, p.warranty_months,
              p.features, p.specs, p.images, p.stock, p.is_featured,
              COALESCE(rv.cnt,0)::int  AS review_count,
              COALESCE(rv.avg,0)::float AS rating_avg
       FROM products p
       LEFT JOIN (
         SELECT product_id, COUNT(*) cnt, ROUND(AVG(rating)::numeric, 2) avg
         FROM shop_reviews WHERE status='published'
         GROUP BY product_id
       ) rv ON rv.product_id = p.id
       WHERE p.is_active = TRUE ${filter}
       ORDER BY p.sort_order ASC, p.id ASC`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[SHOP] listProducts:', err);
    res.status(500).json({ error: 'Failed to load products' });
  }
}

/** GET /api/shop/products/:slug — single product by slug */
async function getProduct(req, res) {
  try {
    const r = await db.query(
      `SELECT p.*,
              COALESCE(rv.cnt,0)::int   AS review_count,
              COALESCE(rv.avg,0)::float AS rating_avg
       FROM products p
       LEFT JOIN (
         SELECT product_id, COUNT(*) cnt, ROUND(AVG(rating)::numeric, 2) avg
         FROM shop_reviews WHERE status='published'
         GROUP BY product_id
       ) rv ON rv.product_id = p.id
       WHERE p.slug = $1 AND p.is_active = TRUE LIMIT 1`,
      [req.params.slug]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[SHOP] getProduct:', err);
    res.status(500).json({ error: 'Failed to load product' });
  }
}

// ─────────────────────────────────────────────────────────
// PUBLIC: Cart validation + Checkout
// ─────────────────────────────────────────────────────────

/**
 * POST /api/shop/cart/validate
 * Body: { items: [{ slug, quantity }] }
 * Returns server-verified prices + totals (clients can't be trusted with prices).
 */
async function validateCart(req, res) {
  try {
    const { items = [] } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const slugs = items.map(i => i.slug);
    const r = await db.query(
      `SELECT id, slug, sku, name, selling_price, gst_rate, stock, images
       FROM products
       WHERE slug = ANY($1::text[]) AND is_active = TRUE`,
      [slugs]
    );

    const bySlug = Object.fromEntries(r.rows.map(p => [p.slug, p]));
    const verified = [];
    let subtotal = 0;
    let tax = 0;

    for (const item of items) {
      const p = bySlug[item.slug];
      if (!p) continue;
      const qty = Math.max(1, Math.min(parseInt(item.quantity) || 1, 5));
      const lineNet  = +(p.selling_price * qty).toFixed(2);
      // GST in India for water purifiers is 18% — price is treated as inclusive.
      // Compute the tax portion for invoicing transparency.
      const lineTax  = +((lineNet * p.gst_rate) / (100 + Number(p.gst_rate))).toFixed(2);
      const lineBase = +(lineNet - lineTax).toFixed(2);
      verified.push({
        product_id:    p.id,
        slug:          p.slug,
        sku:           p.sku,
        name:          p.name,
        image:         (p.images && p.images[0]) || null,
        quantity:      qty,
        unit_price:    +p.selling_price,
        line_base:     lineBase,
        line_tax:      lineTax,
        line_total:    lineNet,
        in_stock:      p.stock > 0,
        gst_rate:      +p.gst_rate,
      });
      subtotal += lineBase;
      tax      += lineTax;
    }

    const total = +(subtotal + tax + FLAT_SHIPPING).toFixed(2);
    res.json({
      items: verified,
      subtotal: +subtotal.toFixed(2),
      tax: +tax.toFixed(2),
      shipping: FLAT_SHIPPING,
      total,
      currency: 'INR',
    });
  } catch (err) {
    console.error('[SHOP] validateCart:', err);
    res.status(500).json({ error: 'Cart validation failed' });
  }
}

/**
 * POST /api/shop/orders — place a guest order (COD default).
 * Body: {
 *   items: [{ slug, quantity }],
 *   customer: { name, email, phone },
 *   shipping_address: { line1, line2, city, state, pincode, country },
 *   payment_method: 'cod' | 'razorpay',
 *   notes
 * }
 */
async function placeOrder(req, res) {
  const client = await db.pool.connect();
  try {
    const { items = [], customer = {}, shipping_address = {}, payment_method = 'cod', notes } = req.body;

    // Basic validation
    if (!items.length) return res.status(400).json({ error: 'Cart is empty' });
    if (!customer.name || !customer.email || !customer.phone)
      return res.status(400).json({ error: 'Customer name, email, phone are required' });
    if (!shipping_address.line1 || !shipping_address.city || !shipping_address.state || !shipping_address.pincode)
      return res.status(400).json({ error: 'Complete shipping address is required' });

    const normPhone = String(customer.phone).replace(/[^0-9]/g, '');
    const phone10 = normPhone.length === 12 && normPhone.startsWith('91')
      ? normPhone.slice(2)
      : normPhone;
    if (phone10.length !== 10) return res.status(400).json({ error: 'Invalid phone number' });

    // Re-validate cart server-side (don't trust client prices)
    const slugs = items.map(i => i.slug);
    const pr = await client.query(
      `SELECT id, slug, sku, name, selling_price, gst_rate, hsn_code, stock
       FROM products
       WHERE slug = ANY($1::text[]) AND is_active = TRUE`,
      [slugs]
    );
    const bySlug = Object.fromEntries(pr.rows.map(p => [p.slug, p]));

    await client.query('BEGIN');

    let subtotal = 0, tax = 0, total = 0;
    const orderItems = [];

    for (const item of items) {
      const p = bySlug[item.slug];
      if (!p) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Product not available: ${item.slug}` });
      }
      const qty = Math.max(1, Math.min(parseInt(item.quantity) || 1, 5));
      if (p.stock < qty) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Only ${p.stock} units in stock for ${p.name}` });
      }
      const lineNet  = +(p.selling_price * qty).toFixed(2);
      const lineTax  = +((lineNet * p.gst_rate) / (100 + Number(p.gst_rate))).toFixed(2);
      const lineBase = +(lineNet - lineTax).toFixed(2);
      subtotal += lineBase;
      tax      += lineTax;
      total    += lineNet;
      orderItems.push({
        product_id:    p.id,
        product_name:  p.name,
        product_sku:   p.sku,
        unit_price:    p.selling_price,
        quantity:      qty,
        line_subtotal: lineBase,
        line_tax:      lineTax,
        line_total:    lineNet,
        hsn_code:      p.hsn_code,
        gst_rate:      p.gst_rate,
      });
    }

    total = +(total + FLAT_SHIPPING).toFixed(2);

    // Generate order number — KN-YY-NNNNN
    const seqR = await client.query(`SELECT nextval('shop_order_seq') AS n`);
    const yy = new Date().getFullYear().toString().slice(-2);
    const order_number = `KN-${yy}-${String(seqR.rows[0].n).padStart(5, '0')}`;

    // Link to logged-in customer if a shop session is active
    const customerId = req.shopCustomer ? req.shopCustomer.id : null;

    // Insert order
    const oR = await client.query(
      `INSERT INTO shop_orders
         (order_number, customer_id, customer_name, customer_email, customer_phone,
          subtotal, tax_amount, shipping_amount, total_amount,
          shipping_address, payment_method, payment_status, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,'pending','pending',$12)
       RETURNING id, order_number, total_amount, created_at`,
      [
        order_number,
        customerId,
        customer.name.trim(),
        customer.email.trim().toLowerCase(),
        phone10,
        +subtotal.toFixed(2),
        +tax.toFixed(2),
        FLAT_SHIPPING,
        total,
        JSON.stringify({ ...shipping_address, full_name: customer.name, phone: phone10 }),
        payment_method,
        notes || null,
      ]
    );
    const order = oR.rows[0];

    // If logged in, update customer aggregates
    if (customerId) {
      await client.query(
        `UPDATE shop_customers
            SET total_orders = total_orders + 1,
                total_spent  = total_spent + $1,
                updated_at   = NOW()
          WHERE id = $2`,
        [total, customerId]
      );
    } else {
      // Auto-create a customer profile so future logins see this order in their history
      await client.query(
        `INSERT INTO shop_customers (phone, name, email, total_orders, total_spent)
         VALUES ($1, $2, $3, 1, $4)
         ON CONFLICT (phone) DO UPDATE
            SET total_orders = shop_customers.total_orders + 1,
                total_spent  = shop_customers.total_spent + EXCLUDED.total_spent,
                name  = COALESCE(shop_customers.name,  EXCLUDED.name),
                email = COALESCE(shop_customers.email, EXCLUDED.email),
                updated_at = NOW()`,
        [phone10, customer.name.trim(), customer.email.trim().toLowerCase(), total]
      );
      // Backfill customer_id on the just-inserted order
      await client.query(
        `UPDATE shop_orders
            SET customer_id = (SELECT id FROM shop_customers WHERE phone = $1)
          WHERE id = $2`,
        [phone10, order.id]
      );
    }

    // Insert items + decrement stock
    for (const it of orderItems) {
      await client.query(
        `INSERT INTO shop_order_items
          (order_id, product_id, product_name, product_sku, unit_price,
           quantity, line_subtotal, line_tax, line_total, hsn_code, gst_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [order.id, it.product_id, it.product_name, it.product_sku, it.unit_price,
         it.quantity, it.line_subtotal, it.line_tax, it.line_total, it.hsn_code, it.gst_rate]
      );
      await client.query(`UPDATE products SET stock = stock - $1 WHERE id = $2`, [it.quantity, it.product_id]);
    }

    await client.query('COMMIT');

    console.log(`[SHOP] order placed ${order.order_number} total=₹${total} method=${payment_method} phone=${phone10}`);

    // Send confirmation WhatsApp to customer (best-effort, don't fail order if WA fails)
    const summary = orderItems.map(i => `• ${i.product_name} × ${i.quantity}`).join('\n');
    wa.sendText(
      '91' + phone10,
      `🎉 *Order Confirmed — ${order.order_number}*\n\n` +
      `Thank you for shopping with Knite!\n\n` +
      `${summary}\n\n` +
      `Total: *₹${total.toLocaleString('en-IN')}*\n` +
      `Payment: ${payment_method.toUpperCase()}\n\n` +
      `We'll dispatch your order shortly and share tracking details on this number.\n\n` +
      `Track at: https://knite.in/order.html?id=${order.id}&phone=${phone10}`,
      { line: 'service' }
    ).catch(e => console.error('[SHOP] customer WA notify failed:', e.message));

    // Notify admin/owner number
    const adminPhone = process.env.ADMIN_NOTIFY_PHONE || '919196068335';
    wa.sendText(
      adminPhone,
      `🛒 *New Order — ${order.order_number}*\n` +
      `${customer.name} · ${customer.email} · +91${phone10}\n` +
      `Total: ₹${total.toLocaleString('en-IN')} · ${payment_method.toUpperCase()}\n` +
      `Items:\n${summary}\n` +
      `Address: ${shipping_address.line1}, ${shipping_address.city} ${shipping_address.pincode}\n\n` +
      `Admin: https://knite.in/admin.html#orders`,
      { line: 'service' }
    ).catch(e => console.error('[SHOP] admin WA notify failed:', e.message));

    res.json({
      ok: true,
      order_id: order.id,
      order_number: order.order_number,
      total: order.total_amount,
      tracking_url: `/order.html?id=${order.id}&phone=${phone10}`,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[SHOP] placeOrder:', err);
    res.status(500).json({ error: err.message || 'Order placement failed' });
  } finally {
    client.release();
  }
}

/**
 * GET /api/shop/orders/:id?phone=10digits — order lookup for tracking
 * Authentication via id + matching customer phone (no login).
 */
async function getOrderForCustomer(req, res) {
  try {
    const { id } = req.params;
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const phone10 = String(phone).replace(/[^0-9]/g, '').slice(-10);

    const oR = await db.query(
      `SELECT * FROM shop_orders WHERE id = $1 AND customer_phone = $2 LIMIT 1`,
      [id, phone10]
    );
    if (!oR.rows.length) return res.status(404).json({ error: 'Order not found' });

    const iR = await db.query(
      `SELECT product_name, product_sku, unit_price, quantity, line_total
       FROM shop_order_items WHERE order_id = $1 ORDER BY id ASC`,
      [id]
    );
    res.json({ ...oR.rows[0], items: iR.rows });
  } catch (err) {
    console.error('[SHOP] getOrderForCustomer:', err);
    res.status(500).json({ error: 'Failed to load order' });
  }
}

// ─────────────────────────────────────────────────────────
// ADMIN: Products + Orders management
// ─────────────────────────────────────────────────────────

async function adminListProducts(req, res) {
  const r = await db.query(
    `SELECT id, slug, sku, name, brand, category, mrp, selling_price, stock,
            is_active, is_featured, sort_order, created_at, updated_at
     FROM products ORDER BY sort_order ASC, id ASC`
  );
  res.json(r.rows);
}

async function adminUpdateProduct(req, res) {
  try {
    const { id } = req.params;
    const allowed = ['name','short_desc','long_desc','mrp','selling_price','stock','is_active','is_featured','sort_order'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) { sets.push(`${k} = $${sets.length + 1}`); vals.push(req.body[k]); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(id);
    await db.query(`UPDATE products SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`, vals);
    res.json({ ok: true });
  } catch (err) {
    console.error('[SHOP] adminUpdateProduct:', err);
    res.status(500).json({ error: err.message });
  }
}

async function adminListOrders(req, res) {
  const { status, limit = 100 } = req.query;
  const params = [];
  let where = '';
  if (status) { params.push(status); where = `WHERE status = $${params.length}`; }
  const r = await db.query(
    `SELECT id, order_number, customer_name, customer_email, customer_phone,
            subtotal, tax_amount, shipping_amount, total_amount,
            status, payment_status, payment_method,
            tracking_number, shipping_carrier, created_at
     FROM shop_orders ${where}
     ORDER BY created_at DESC LIMIT ${parseInt(limit)}`,
    params
  );
  res.json(r.rows);
}

async function adminGetOrder(req, res) {
  const { id } = req.params;
  const oR = await db.query(`SELECT * FROM shop_orders WHERE id = $1`, [id]);
  if (!oR.rows.length) return res.status(404).json({ error: 'Order not found' });
  const iR = await db.query(`SELECT * FROM shop_order_items WHERE order_id = $1 ORDER BY id ASC`, [id]);
  res.json({ ...oR.rows[0], items: iR.rows });
}

async function adminUpdateOrder(req, res) {
  try {
    const { id } = req.params;
    const allowed = ['status','payment_status','tracking_number','shipping_carrier','admin_notes'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) { sets.push(`${k} = $${sets.length + 1}`); vals.push(req.body[k]); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    // Auto-stamp transition timestamps
    if (req.body.status === 'shipped')   sets.push(`shipped_at   = COALESCE(shipped_at,   NOW())`);
    if (req.body.status === 'delivered') sets.push(`delivered_at = COALESCE(delivered_at, NOW())`);
    if (req.body.status === 'cancelled') sets.push(`cancelled_at = COALESCE(cancelled_at, NOW())`);
    if (req.body.payment_status === 'paid') sets.push(`paid_at = COALESCE(paid_at, NOW())`);

    vals.push(id);
    const r = await db.query(
      `UPDATE shop_orders SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}
       RETURNING id, order_number, customer_phone, status, tracking_number, shipping_carrier`,
      vals
    );
    const o = r.rows[0];

    // If transition to shipped, notify customer
    if (req.body.status === 'shipped' && o) {
      const trackingMsg = o.tracking_number
        ? `\nTracking: *${o.tracking_number}* (${o.shipping_carrier || 'Courier'})`
        : '';
      wa.sendText(
        '91' + o.customer_phone,
        `📦 *Your Knite order ${o.order_number} is on its way!*${trackingMsg}\n\n` +
        `Track at: https://knite.in/order.html?id=${o.id}&phone=${o.customer_phone}\n\n` +
        `— Team Knite`,
        { line: 'service' }
      ).catch(() => {});
    }
    if (req.body.status === 'delivered' && o) {
      // 1. Delivery notification
      wa.sendText(
        '91' + o.customer_phone,
        `✅ *Order ${o.order_number} delivered!*\n\n` +
        `Hope you love your new Knite purifier. Need installation? Reply INSTALL and we'll arrange it free of cost.\n\n` +
        `— Team Knite`,
        { line: 'service' }
      ).catch(() => {});

      // 2. Auto-generate GST invoice + send as WhatsApp document (best-effort)
      (async () => {
        try {
          const inv = await invoiceGen.generateInvoiceForOrder(o.id);
          await wa.sendDocument(
            '91' + o.customer_phone,
            inv.file_path,
            {
              filename: `Knite-Invoice-${o.order_number}.pdf`,
              caption: `📄 *Tax Invoice — ${inv.invoice_number}*\n\nYour GST invoice for order ${o.order_number} is attached. Save it for warranty claims and tax records.\n\n— Team Knite`,
              mimeType: 'application/pdf',
              fallbackUrl: inv.invoice_url,
            },
            { line: 'service' }
          );
          await db.query(`UPDATE shop_orders SET invoice_sent_at = NOW() WHERE id = $1`, [o.id]);
          console.log(`[SHOP] invoice ${inv.invoice_number} sent for order ${o.order_number}`);
        } catch (err) {
          console.error(`[SHOP] invoice generation/send failed for order ${o.id}:`, err.message);
        }
      })();
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[SHOP] adminUpdateOrder:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  // public
  listProducts,
  getProduct,
  validateCart,
  placeOrder,
  getOrderForCustomer,
  // admin
  adminListProducts,
  adminUpdateProduct,
  adminListOrders,
  adminGetOrder,
  adminUpdateOrder,
};
