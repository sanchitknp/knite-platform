/**
 * Flow 5: Ownership Transfer
 */
const db = require('../../db');
const wa = require('../whatsappService');
const session = require('../sessionService');

async function handleTransferRequest(phone, ctx) {
  // Get unit and original owner
  const unitResult = await db.query(
    `SELECT u.*, c.phone as owner_phone, c.name as owner_name
     FROM units u JOIN customers c ON c.id = u.customer_id
     WHERE u.id = $1`,
    [ctx.unit_id]
  );
  const unit = unitResult.rows[0];
  if (!unit) {
    await wa.sendText(phone, `❌ Unit not found.`);
    return;
  }

  await session.setSession(phone, {
    flow: 'ownership_transfer',
    step: 'awaiting_original_owner_confirm',
    context_data: { ...ctx, new_phone: phone }
  });

  // Notify original owner
  await wa.sendButtons(unit.owner_phone,
    `⚠️ *Ownership Transfer Request*\n\n` +
    `Someone with number *${phone}* is requesting ownership of your unit *${unit.unit_id}*.\n\n` +
    `Did you sell or give away this RO unit?`,
    [
      { id: `TRANSFER_APPROVE_${unit.id}_${phone}`, title: '✅ Yes, Transfer It' },
      { id: `TRANSFER_DENY_${unit.id}_${phone}`, title: '❌ No, Keep It' },
    ]
  );

  await wa.sendText(phone,
    `⏳ We've notified the registered owner of *${unit.unit_id}*.\n\n` +
    `You'll receive a confirmation once they approve the transfer.`
  );
}

async function handleTransferApprove(phone, unitId, newPhone) {
  // Transfer ownership
  const newCustomerResult = await db.query(
    `INSERT INTO customers (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET updated_at = now() RETURNING *`,
    [newPhone]
  );
  const newCustomer = newCustomerResult.rows[0];

  const unitResult = await db.query(`SELECT * FROM units WHERE id = $1`, [unitId]);
  const unit = unitResult.rows[0];

  await db.query(
    `UPDATE units SET customer_id = $1, status = 'registered', install_date = NULL, warranty_expires_at = NULL,
      install_address = NULL, zone_id = NULL, updated_at = now()
     WHERE id = $2`,
    [newCustomer.id, unitId]
  );

  await db.query(
    `SELECT log_unit_event($1, 'ownership_transferred', 'active', 'registered', 'customer', $2, $3)`,
    [unitId, newCustomer.id, JSON.stringify({ from_phone: phone, to_phone: newPhone })]
  );

  await wa.sendText(phone, `✅ Transfer approved! Unit ${unit.unit_id} is no longer registered to your account.`);

  await session.clearSession(newPhone);
  await wa.sendText(newPhone,
    `✅ *Transfer Approved!*\n\n` +
    `Unit *${unit.unit_id}* is now in your name.\n\n` +
    `Please share your installation address to schedule installation:`
  );

  await session.setSession(newPhone, {
    flow: 'installation',
    step: 'awaiting_address',
    context_data: { unit_id: unitId, unit_code: unit.unit_id, customer_id: newCustomer.id }
  });
}

async function handleTransferDeny(phone, unitId, newPhone) {
  await wa.sendText(phone, `✅ Transfer denied. Unit ownership unchanged.`);

  const unitResult = await db.query(`SELECT * FROM units WHERE id = $1`, [unitId]);
  const unit = unitResult.rows[0];

  // Notify the requester that transfer was denied
  if (newPhone) {
    await wa.sendText(newPhone,
      `⚠️ The original owner has *denied* the transfer of unit *${unit?.unit_id}*.\n\n` +
      `Please contact the seller/original owner directly. If you believe this is a fraud, contact us.`
    );
  }
}

module.exports = { handleTransferRequest, handleTransferApprove, handleTransferDeny };
