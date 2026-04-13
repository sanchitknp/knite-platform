/**
 * WhatsApp Service — abstraction over Meta Cloud API / Simulator.
 *
 * WHATSAPP_MODE=simulator  → messages stored in outbound_messages table, polled by browser UI
 * WHATSAPP_MODE=production → messages sent via Meta Cloud API (graph.facebook.com)
 */
const db = require('../db');

const MODE = process.env.WHATSAPP_MODE || 'simulator';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const META_API_URL = `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`;

// ─────────────────────────────────────────────
// Meta Cloud API sender
// ─────────────────────────────────────────────
async function callMetaAPI(payload) {
  try {
    const res = await fetch(META_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[META API ERROR]', JSON.stringify(data));
    } else {
      console.log(`[META→${payload.to}] sent msgId=${data.messages?.[0]?.id}`);
    }
    return data;
  } catch (err) {
    console.error('[META API FETCH ERROR]', err.message);
  }
}

// ─────────────────────────────────────────────
// Simulator queue
// ─────────────────────────────────────────────
async function queueSimulator(toPhone, messageType, body, buttons = null) {
  await db.query(
    `INSERT INTO outbound_messages (to_phone, message_type, body, buttons)
     VALUES ($1, $2, $3, $4)`,
    [toPhone, messageType, body, buttons ? JSON.stringify(buttons) : null]
  );
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Send a plain text message
 */
async function sendText(toPhone, body) {
  console.log(`[WA→${toPhone}] TEXT: ${body.substring(0, 80)}`);

  if (MODE === 'production') {
    await callMetaAPI({
      to: toPhone,
      type: 'text',
      text: { preview_url: false, body },
    });
  } else {
    await queueSimulator(toPhone, 'text', body);
  }
}

/**
 * Send a message with interactive reply buttons (max 3 real WA buttons, unlimited in simulator)
 * Falls back to numbered list text if > 3 buttons in production.
 */
async function sendButtons(toPhone, body, buttons) {
  console.log(`[WA→${toPhone}] BUTTONS(${buttons.length}): ${body.substring(0, 60)}`);

  if (MODE === 'production') {
    if (buttons.length <= 3) {
      // Use WhatsApp interactive reply buttons
      await callMetaAPI({
        to: toPhone,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: {
            buttons: buttons.map(b => ({
              type: 'reply',
              reply: {
                id: b.id.substring(0, 256),
                title: b.title.substring(0, 20),
              },
            })),
          },
        },
      });
    } else {
      // > 3 buttons: use WhatsApp List message
      await callMetaAPI({
        to: toPhone,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body },
          action: {
            button: 'Choose option',
            sections: [{
              title: 'Options',
              rows: buttons.map((b, i) => ({
                id: b.id.substring(0, 200),
                title: b.title.substring(0, 24),
              })),
            }],
          },
        },
      });
    }
  } else {
    await queueSimulator(toPhone, 'buttons', body, buttons);
  }
}

/**
 * Send a list/menu style message
 */
async function sendList(toPhone, body, items) {
  const buttons = items.map((item, i) => ({ id: String(i + 1), title: item }));
  await sendButtons(toPhone, body, buttons);
}

/**
 * Send a template message (used when 24-hr window expired)
 */
async function sendTemplate(toPhone, templateName, body, buttons = null) {
  if (buttons) {
    await sendButtons(toPhone, `[TEMPLATE: ${templateName}]\n\n${body}`, buttons);
  } else {
    await sendText(toPhone, `[TEMPLATE: ${templateName}]\n\n${body}`);
  }
}

// ─────────────────────────────────────────────
// Simulator polling (browser UI)
// ─────────────────────────────────────────────
async function getPendingMessages(phone) {
  // Mark undelivered messages as delivered and return them
  const fresh = await db.query(
    `UPDATE outbound_messages SET delivered = true
     WHERE to_phone = $1 AND delivered = false
     RETURNING *`,
    [phone]
  );

  // Also return any messages delivered in the last 60 seconds
  // (covers the case where the simulator missed them due to phone switching)
  const recent = await db.query(
    `SELECT * FROM outbound_messages
     WHERE to_phone = $1
       AND delivered = true
       AND created_at > now() - INTERVAL '60 seconds'
     ORDER BY created_at ASC`,
    [phone]
  );

  // Merge: fresh first, then recently-delivered ones not already in fresh
  const freshIds = new Set(fresh.rows.map(r => r.id));
  const merged = [
    ...fresh.rows,
    ...recent.rows.filter(r => !freshIds.has(r.id)),
  ];
  merged.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return merged;
}

async function getAllRecentMessages(limit = 50) {
  const result = await db.query(
    `SELECT * FROM outbound_messages ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

module.exports = {
  sendText,
  sendButtons,
  sendList,
  sendTemplate,
  getPendingMessages,
  getAllRecentMessages,
};
