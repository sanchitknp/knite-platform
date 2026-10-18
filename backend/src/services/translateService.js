// ─────────────────────────────────────────────────────────────
// Translation service — Google Cloud Translation v2 (REST).
// Used to send WhatsApp messages (to technicians/customers) in a chosen language.
// Best-effort: any failure (or target 'en'/empty) returns the original text, so a
// translation hiccup never blocks a message from being sent.
//   Env: GOOGLE_TRANSLATE_KEY  (restricted to translate.googleapis.com + VM IP)
// ─────────────────────────────────────────────────────────────
const KEY = process.env.GOOGLE_TRANSLATE_KEY || '';
const URL = 'https://translation.googleapis.com/language/translate/v2';

// Languages we offer in the admin UI (code → English label). Google supports many more.
const SUPPORTED = {
  en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', kn: 'Kannada',
  ml: 'Malayalam', bn: 'Bengali', mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi',
  or: 'Odia', as: 'Assamese', ur: 'Urdu',
};

function isConfigured() { return !!KEY; }

// Brand / proper terms that must NOT be translated or transliterated. Google otherwise
// renders "Knite" phonetically in Indic scripts (e.g. Kannada "ನೈಟ್" ≈ "Night"), mangling
// the brand. We swap them for {{N}} placeholders (which survive translation verbatim),
// translate, then restore the exact term.
const PROTECT = ['Knite'];
function _protect(text) {
  const tokens = [];
  let out = text;
  for (const term of PROTECT) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(re, () => { const ph = `{{${tokens.length}}}`; tokens.push(term); return ph; });
  }
  return { out, tokens };
}
function _restore(text, tokens) {
  let out = text;
  tokens.forEach((term, i) => {
    out = out.replace(new RegExp(`\\{\\{\\s*${i}\\s*\\}\\}`, 'g'), term);
  });
  return out;
}

/**
 * Translate text into targetLang. Returns the original text unchanged when the target
 * is English/empty, translation isn't configured, or the API call fails.
 * @param {string} text
 * @param {string} targetLang  ISO code e.g. 'ta', 'kn', 'bn'
 * @returns {Promise<string>}
 */
async function translate(text, targetLang) {
  const lang = String(targetLang || '').trim().toLowerCase();
  if (!text || !lang || lang === 'en' || !KEY) return text;
  const { out: q, tokens } = _protect(text);
  try {
    const res = await fetch(`${URL}?key=${KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, target: lang, format: 'text' }),
    });
    const data = await res.json();
    const out = data?.data?.translations?.[0]?.translatedText;
    if (!res.ok || !out) {
      console.error('[TRANSLATE] failed:', res.status, JSON.stringify(data?.error || data));
      return text;
    }
    return _restore(out, tokens);
  } catch (e) {
    console.error('[TRANSLATE] error:', e.message);
    return text;
  }
}

module.exports = { translate, isConfigured, SUPPORTED };
