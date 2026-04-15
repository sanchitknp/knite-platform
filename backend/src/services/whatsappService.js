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
  const body = JSON.stringify({ messaging_product: 'whatsapp', ...payload });
  console.log('[META API REQUEST]', body);
  try {
    const res = await fetch(META_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body,
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
    console.error('[META API FETCH ERROR cause]', err.cause?.message || err.cause || '(no cause)');
    console.error('[META API FETCH ERROR stack]', err.stack);
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
    } else if (buttons.length <= 10) {
      // 4–10 buttons: use WhatsApp interactive list message (dropdown)
      await callMetaAPI({
        to: toPhone,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body },
          action: {
            button: 'Choose an option',
            sections: [{
              rows: buttons.map(b => ({
                id: b.id.substring(0, 200),
                title: b.title.substring(0, 24),
              })),
            }],
          },
        },
      });
    } else {
      // > 10 buttons: plain numbered text (last resort)
      const lines = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
      await callMetaAPI({
        to: toPhone,
        type: 'text',
        text: { body: `${body}\n\n${lines}\n\nReply with a number.` },
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

/**
 * Send a WhatsApp Flow message
 */
async function sendFlow(toPhone, bodyText, flowId, flowToken, ctaText = 'Open Form', initialScreen = 'STATE_SCREEN', screenData = null) {
  console.log(`[WA→${toPhone}] FLOW: ${bodyText.substring(0, 60)}`);
  if (MODE === 'production') {
    const flowActionPayload = { screen: initialScreen };
    if (screenData) flowActionPayload.data = screenData;

    await callMetaAPI({
      to: toPhone,
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: { text: bodyText },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token: flowToken,
            flow_id: flowId,
            flow_cta: ctaText,
            flow_action: 'navigate',
            flow_action_payload: flowActionPayload,
          },
        },
      },
    });
  } else {
    // Simulator fallback: show as text prompt
    await queueSimulator(toPhone, 'text',
      `[FLOW] ${bodyText}\n\n_(WhatsApp Flow — use production mode to see the native form)_`,
      []
    );
  }
}

/**
 * Send a location message (pin on map) to a phone number
 */
async function sendLocation(toPhone, latitude, longitude, name = '', address = '') {
  console.log(`[WA→${toPhone}] LOCATION: lat=${latitude} lng=${longitude}`);
  if (MODE === 'production') {
    await callMetaAPI({
      to: toPhone,
      type: 'location',
      location: { latitude, longitude, name, address },
    });
  } else {
    await queueSimulator(toPhone, 'text',
      `[LOCATION PIN] ${name || 'Installation Location'}\n📍 ${address || ''}\nhttps://maps.google.com/?q=${latitude},${longitude}`
    );
  }
}

/**
 * Send a location request message.
 * Renders a tappable button in WhatsApp that opens the location picker directly.
 */
async function sendLocationRequest(toPhone, bodyText) {
  console.log(`[WA→${toPhone}] LOCATION_REQUEST: ${bodyText.substring(0, 60)}`);
  if (MODE === 'production') {
    await callMetaAPI({
      to: toPhone,
      type: 'interactive',
      interactive: {
        type: 'location_request_message',
        body: { text: bodyText },
        action: { name: 'send_location' },
      },
    });
  } else {
    await queueSimulator(toPhone, 'text',
      `[LOCATION REQUEST] ${bodyText}\n\n_(Tap to share location — production only)_`,
      []
    );
  }
}

module.exports = {
  sendText,
  sendButtons,
  sendList,
  sendFlow,
  sendLocation,
  sendLocationRequest,
  sendTemplate,
  getPendingMessages,
  getAllRecentMessages,
};
