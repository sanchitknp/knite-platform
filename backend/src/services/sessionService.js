const db = require('../db');

/**
 * Get or create a WhatsApp session for a phone number
 */
async function getSession(phone) {
  const result = await db.query(
    `SELECT * FROM whatsapp_sessions WHERE phone = $1`,
    [phone]
  );
  return result.rows[0] || null;
}

/**
 * Create or update a session
 */
async function setSession(phone, updates) {
  const existing = await getSession(phone);
  
  if (!existing) {
    const result = await db.query(
      `INSERT INTO whatsapp_sessions (phone, actor_type, flow, step, context_data, last_message_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING *`,
      [
        phone,
        updates.actor_type || 'customer',
        updates.flow || null,
        updates.step || null,
        JSON.stringify(updates.context_data || {}),
      ]
    );
    return result.rows[0];
  } else {
    const merged = {
      ...existing.context_data,
      ...(updates.context_data || {}),
    };
    const result = await db.query(
      `UPDATE whatsapp_sessions SET
        actor_type = COALESCE($2, actor_type),
        flow = $3,
        step = $4,
        context_data = $5,
        last_message_at = now(),
        updated_at = now()
       WHERE phone = $1
       RETURNING *`,
      [
        phone,
        updates.actor_type || existing.actor_type,
        updates.flow !== undefined ? updates.flow : existing.flow,
        updates.step !== undefined ? updates.step : existing.step,
        JSON.stringify(merged),
      ]
    );
    return result.rows[0];
  }
}

/**
 * Update only context_data fields without changing flow/step
 */
async function updateContext(phone, contextUpdates) {
  const existing = await getSession(phone);
  if (!existing) return null;
  
  const merged = { ...existing.context_data, ...contextUpdates };
  const result = await db.query(
    `UPDATE whatsapp_sessions SET context_data = $2, last_message_at = now(), updated_at = now()
     WHERE phone = $1 RETURNING *`,
    [phone, JSON.stringify(merged)]
  );
  return result.rows[0];
}

/**
 * Clear/reset a session
 */
async function clearSession(phone) {
  await db.query(
    `UPDATE whatsapp_sessions SET flow = NULL, step = NULL, context_data = '{}', updated_at = now()
     WHERE phone = $1`,
    [phone]
  );
}

module.exports = { getSession, setSession, updateContext, clearSession };
