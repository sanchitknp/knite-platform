// ─────────────────────────────────────────────────────────────
// SMS service — MSG91 (India). Used to DELIVER OTPs by SMS.
// We keep generating/storing/verifying the OTP ourselves (shop_otps);
// MSG91 only sends the message, via a DLT-registered template ("Flow").
//
// Env vars:
//   MSG91_AUTHKEY           MSG91 auth key
//   MSG91_OTP_TEMPLATE_ID   the MSG91 Flow/Template id mapped to the DLT OTP template
//   MSG91_SENDER_ID         DLT-registered 6-char header (e.g. KNITEP)   [optional if baked into the flow]
//   MSG91_OTP_VAR           template variable name that carries the OTP  (default: "var1")
//   SMS_MODE                "production" (send) | anything else = log only (default: production if AUTHKEY set)
// ─────────────────────────────────────────────────────────────

const AUTHKEY     = process.env.MSG91_AUTHKEY || '';
const TEMPLATE_ID = process.env.MSG91_OTP_TEMPLATE_ID || '';
const SENDER_ID   = process.env.MSG91_SENDER_ID || '';
const OTP_VAR     = process.env.MSG91_OTP_VAR || 'var1';
const FLOW_URL    = 'https://control.msg91.com/api/v5/flow';

function isConfigured() {
  return !!(AUTHKEY && TEMPLATE_ID);
}

// Normalise to MSG91 format: country code + 10 digits, no +.
function normalise(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;
  return d;
}

/**
 * Send an OTP by SMS via MSG91's Flow API.
 * @param {string} phone  10-digit or 91-prefixed
 * @param {string} otp
 * @returns {Promise<{ok:boolean, raw?:any, error?:string}>}
 */
async function sendOtpSms(phone, otp) {
  if (!isConfigured()) return { ok: false, error: 'SMS not configured' };
  const mobiles = normalise(phone);
  if (!/^\d{12}$/.test(mobiles)) return { ok: false, error: 'invalid phone' };

  const recipient = { mobiles, [OTP_VAR]: String(otp) };
  const body = {
    template_id: TEMPLATE_ID,
    short_url: '0',
    recipients: [recipient],
  };
  if (SENDER_ID) body.sender = SENDER_ID;

  try {
    const res = await fetch(FLOW_URL, {
      method: 'POST',
      headers: { authkey: AUTHKEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    // MSG91 success → { type: "success", message: "<request_id>" }
    const ok = res.ok && String(data.type).toLowerCase() === 'success';
    if (!ok) console.error('[MSG91] send failed:', res.status, JSON.stringify(data));
    else console.log(`[MSG91] OTP SMS sent to ${mobiles} reqId=${data.message}`);
    return { ok, raw: data, error: ok ? undefined : (data.message || ('HTTP ' + res.status)) };
  } catch (e) {
    console.error('[MSG91] request error:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { isConfigured, sendOtpSms, normalise };
