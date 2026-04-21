/**
 * WhatsApp Service — abstraction over Meta Cloud API / Simulator.
 *
 * WHATSAPP_MODE=simulator  → messages stored in outbound_messages table, polled by browser UI
 * WHATSAPP_MODE=production → messages sent via Meta Cloud API (graph.facebook.com)
 *
 * ─────────────────────────────────────────────
 * Two-number routing
 * ─────────────────────────────────────────────
 * Knite runs on two WhatsApp Business numbers:
 *   - TECH    (+91 91960 68335)  → technician onboarding + job lifecycle
 *   - SERVICE (+1 555-176-4026)  → customer installation + repair/support
 *
 * Every outbound sender accepts an optional 3rd/last `opts` argument:
 *   opts = { line: 'tech' | 'service', fromPhoneId?: '...' }
 *
 * Resolution order for "which phone number to send FROM":
 *   1. opts.fromPhoneId (explicit)
 *   2. opts.line → TECH_PHONE_NUMBER_ID / SERVICE_PHONE_NUMBER_ID
 *   3. Fallback: SERVICE line (customer-facing, safer default)
 *
 * Incoming webhooks should look up the line via `lineFor(receivedOnPhoneId)`
 * and thread it through to the reply call.
 */
const db = require('../db');

const MODE = process.env.WHATSAPP_MODE || 'simulator';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

const TECH_PHONE_ID    = process.env.TECH_PHONE_NUMBER_ID    || process.env.PHONE_NUMBER_ID;
const SERVICE_PHONE_ID = process.env.SERVICE_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID;

const TECH_DISPLAY    = process.env.TECH_DISPLAY_PHONE    || '+919196068335';
const SERVICE_DISPLAY = process.env.SERVICE_DISPLAY_PHONE || '+15551764026';

/**
 * Given a phone_number_id seen on an incoming webhook, return which
 * "line" (role) it belongs to.
 */
function lineFor(phoneNumberId) {
  if (!phoneNumberId) return 'unknown';
  if (String(phoneNumberId) === String(TECH_PHONE_ID))    return 'tech';
  if (String(phoneNumberId) === String(SERVICE_PHONE_ID)) return 'service';
  return 'unknown';
}

/**
 * Resolve `opts` → the phone_number_id to POST to.
 * - opts.fromPhoneId wins (explicit override)
 * - opts.line selects tech/service
 * - neither present → service (safer default; most traffic is customer-facing)
 */
function resolveFromPhoneId(opts) {
  if (opts && opts.fromPhoneId) return opts.fromPhoneId;
  if (opts && opts.line === 'tech') return TECH_PHONE_ID;
  if (opts && opts.line === 'service') return SERVICE_PHONE_ID;
  return SERVICE_PHONE_ID;
}

/**
 * Human-friendly display for a line — used in cross-line redirect copy.
 */
function displayPhoneFor(line) {
  if (line === 'tech') return TECH_DISPLAY;
  if (line === 'service') return SERVICE_DISPLAY;
  return '';
}

/**
 * wa.me deep-link phone (digits only, no + or spaces) for a line.
 */
function waMePhoneFor(line) {
  return (displayPhoneFor(line) || '').replace(/\D/g, '');
}

// ─────────────────────────────────────────────
// Meta Cloud API sender
// ─────────────────────────────────────────────
async function callMetaAPI(payload, fromPhoneId) {
  const url = `https://graph.facebook.com/v25.0/${fromPhoneId}/messages`;
  const body = JSON.stringify({ messaging_product: 'whatsapp', ...payload });
  console.log(`[META API REQUEST] from=${fromPhoneId} ${body}`);
  try {
    const res = await fetch(url, {
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
      console.log(`[META→${payload.to}] from=${fromPhoneId} sent msgId=${data.messages?.[0]?.id}`);
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
 * Send a plain text message.
 * @param {string} toPhone
 * @param {string} body
 * @param {{line?: 'tech'|'service', fromPhoneId?: string}} [opts]
 */
async function sendText(toPhone, body, opts = {}) {
  const fromPhoneId = resolveFromPhoneId(opts);
  console.log(`[WA→${toPhone}] from=${fromPhoneId} TEXT: ${body.substring(0, 80)}`);

  if (MODE === 'production') {
    await callMetaAPI({
      to: toPhone,
      type: 'text',
      text: { preview_url: false, body },
    }, fromPhoneId);
  } else {
    await queueSimulator(toPhone, 'text', body);
  }
}

/**
 * Send a message with interactive reply buttons (max 3 real WA buttons, unlimited in simulator)
 * Falls back to numbered list text if > 3 buttons in production.
 */
async function sendButtons(toPhone, body, buttons, opts = {}) {
  const fromPhoneId = resolveFromPhoneId(opts);
  console.log(`[WA→${toPhone}] from=${fromPhoneId} BUTTONS(${buttons.length}): ${body.substring(0, 60)}`);

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
      }, fromPhoneId);
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
      }, fromPhoneId);
    } else {
      // > 10 buttons: plain numbered text (last resort)
      const lines = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
      await callMetaAPI({
        to: toPhone,
        type: 'text',
        text: { body: `${body}\n\n${lines}\n\nReply with a number.` },
      }, fromPhoneId);
    }
  } else {
    await queueSimulator(toPhone, 'buttons', body, buttons);
  }
}

/**
 * Send a list/menu style message
 */
async function sendList(toPhone, body, items, opts = {}) {
  const buttons = items.map((item, i) => ({ id: String(i + 1), title: item }));
  await sendButtons(toPhone, body, buttons, opts);
}

/**
 * Send a template message (used when 24-hr window expired)
 */
async function sendTemplate(toPhone, templateName, body, buttons = null, opts = {}) {
  if (buttons) {
    await sendButtons(toPhone, `[TEMPLATE: ${templateName}]\n\n${body}`, buttons, opts);
  } else {
    await sendText(toPhone, `[TEMPLATE: ${templateName}]\n\n${body}`, opts);
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
 *
 * useDataExchange = true  → flow_action: 'data_exchange'
 *   WhatsApp calls the exchange endpoint on open (INIT), enabling dynamic
 *   screen data. Use this for flows with data_api_version.
 *
 * useDataExchange = false (default) → flow_action: 'navigate'
 *   Opens directly to initialScreen with optional screenData payload.
 */
async function sendFlow(toPhone, bodyText, flowId, flowToken, ctaText = 'Open Form', initialScreen = 'STATE_SCREEN', screenData = null, useDataExchange = false, opts = {}) {
  const fromPhoneId = resolveFromPhoneId(opts);
  console.log(`[WA→${toPhone}] from=${fromPhoneId} FLOW(${useDataExchange ? 'data_exchange' : 'navigate'}): ${bodyText.substring(0, 60)}`);
  if (MODE === 'production') {
    let parameters;

    if (useDataExchange) {
      parameters = {
        flow_message_version: '3',
        flow_token: flowToken,
        flow_id: flowId,
        flow_cta: ctaText,
        flow_action: 'data_exchange',
      };
    } else {
      const flowActionPayload = { screen: initialScreen };
      if (screenData) flowActionPayload.data = screenData;
      parameters = {
        flow_message_version: '3',
        flow_token: flowToken,
        flow_id: flowId,
        flow_cta: ctaText,
        flow_action: 'navigate',
        flow_action_payload: flowActionPayload,
      };
    }

    await callMetaAPI({
      to: toPhone,
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: { text: bodyText },
        action: { name: 'flow', parameters },
      },
    }, fromPhoneId);
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
async function sendLocation(toPhone, latitude, longitude, name = '', address = '', opts = {}) {
  const fromPhoneId = resolveFromPhoneId(opts);
  console.log(`[WA→${toPhone}] from=${fromPhoneId} LOCATION: lat=${latitude} lng=${longitude}`);
  if (MODE === 'production') {
    await callMetaAPI({
      to: toPhone,
      type: 'location',
      location: { latitude, longitude, name, address },
    }, fromPhoneId);
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
async function sendLocationRequest(toPhone, bodyText, opts = {}) {
  const fromPhoneId = resolveFromPhoneId(opts);
  console.log(`[WA→${toPhone}] from=${fromPhoneId} LOCATION_REQUEST: ${bodyText.substring(0, 60)}`);
  if (MODE === 'production') {
    await callMetaAPI({
      to: toPhone,
      type: 'interactive',
      interactive: {
        type: 'location_request_message',
        body: { text: bodyText },
        action: { name: 'send_location' },
      },
    }, fromPhoneId);
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
  // Line routing helpers
  lineFor,
  displayPhoneFor,
  waMePhoneFor,
  TECH_PHONE_ID,
  SERVICE_PHONE_ID,
};
