/**
 * Technician Referral Flow
 *
 * - REFER command → show referral link
 * - /ref/:code  → redirect to WhatsApp pre-filled with registration message
 * - On registration with code → save referral mapping
 * - On job completion → increment referred tech's job count → pay referrer if threshold hit
 *
 * Scheme is configurable via referral_schemes table (one active row at a time).
 */
const db = require('../../db');
const wa = require('../whatsappService');

// ─────────────────────────────────────────────
// Get active scheme
// ─────────────────────────────────────────────

async function getActiveScheme() {
  const result = await db.query(
    `SELECT * FROM referral_schemes WHERE is_active = true ORDER BY created_at DESC LIMIT 1`
  );
  return result.rows[0] || { jobs_threshold: 5, reward_paise: 5000 };
}

// ─────────────────────────────────────────────
// Ensure technician has a referral code
// ─────────────────────────────────────────────

async function ensureReferralCode(techId) {
  // Try to return existing code first
  const existing = await db.query(
    `SELECT referral_code FROM technicians WHERE id = $1`, [techId]
  );
  if (existing.rows[0]?.referral_code) return existing.rows[0].referral_code;

  // Generate a unique 8-char code
  let code, attempts = 0;
  do {
    code = Math.random().toString(36).substring(2, 10).toUpperCase();
    const conflict = await db.query(
      `SELECT 1 FROM technicians WHERE referral_code = $1`, [code]
    );
    if (conflict.rowCount === 0) break;
  } while (++attempts < 10);

  await db.query(
    `UPDATE technicians SET referral_code = $1 WHERE id = $2`, [code, techId]
  );
  return code;
}

// ─────────────────────────────────────────────
// Handle REFER command from technician
// ─────────────────────────────────────────────

async function handleRefer(phone) {
  const techResult = await db.query(
    `SELECT * FROM technicians WHERE phone = $1`, [phone]
  );
  const tech = techResult.rows[0];

  if (!tech) {
    // Not registered at all
    await wa.sendText(phone,
      `🤝 *Refer a Technician & Earn!*\n\n` +
      `To refer others and earn rewards, you first need to be a registered Knite technician.\n\n` +
      `👨‍🔧 Type *Join as Technician* or reply *JOIN* to register — it's free and takes just a few minutes!\n\n` +
      `💰 Once approved, you'll earn *₹50 for every 5 jobs* completed by each technician you refer.`
    );
    return;
  }

  if (!tech.is_verified) {
    await wa.sendText(phone,
      `⏳ *Your registration is still pending approval.*\n\n` +
      `Once our admin verifies your account, you'll be able to refer other technicians and earn rewards.\n\n` +
      `We'll notify you on WhatsApp as soon as you're approved!`
    );
    return;
  }

  if (!tech.is_active) {
    await wa.sendText(phone,
      `❌ *Your technician account is currently inactive.*\n\n` +
      `Please contact support to reactivate your account before referring others.`
    );
    return;
  }

  const code = await ensureReferralCode(tech.id);
  const scheme = await getActiveScheme();
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  const referralUrl = `${publicUrl}/ref/${code}`;

  // Referral stats
  const statsResult = await db.query(
    `SELECT
       COUNT(*) AS total_referred,
       COALESCE(SUM(rewards_paid), 0) AS total_rewards_paid,
       COALESCE(SUM(jobs_completed), 0) AS total_jobs_by_referred
     FROM referrals WHERE referrer_id = $1`,
    [tech.id]
  );
  const stats = statsResult.rows[0];
  const totalEarned = parseInt(stats.total_rewards_paid) * (scheme.reward_paise / 100);

  await wa.sendText(phone,
    `🤝 *Refer a Technician & Earn!*\n\n` +
    `💰 *Earn ₹${scheme.reward_paise / 100}* every time your referred technician completes *${scheme.jobs_threshold} jobs*\n\n` +
    `🔗 *Your referral link:*\n${referralUrl}\n\n` +
    `_Share this link with anyone who wants to join Knite as a technician. When they click it and register, they'll be linked to you automatically._\n\n` +
    `📊 *Your referral stats:*\n` +
    `• Technicians referred: ${stats.total_referred}\n` +
    `• Jobs completed by referrals: ${stats.total_jobs_by_referred}\n` +
    `• Total earned from referrals: ₹${totalEarned}`
  );
}

// ─────────────────────────────────────────────
// Save referral mapping after registration
// ─────────────────────────────────────────────

async function saveReferral(referredTechId, referralCode) {
  if (!referralCode) return;

  const referrerResult = await db.query(
    `SELECT id FROM technicians WHERE referral_code = $1`, [referralCode]
  );
  const referrer = referrerResult.rows[0];
  if (!referrer) return;

  // Don't allow self-referral
  if (referrer.id === referredTechId) return;

  const scheme = await getActiveScheme();

  await db.query(
    `INSERT INTO referrals (referrer_id, referred_id, scheme_id, jobs_completed, rewards_paid)
     VALUES ($1, $2, $3, 0, 0)
     ON CONFLICT (referred_id) DO NOTHING`,
    [referrer.id, referredTechId, scheme.id]
  );

  console.log(`[REFERRAL] Tech ${referredTechId} referred by ${referrer.id} (code: ${referralCode})`);
}

// ─────────────────────────────────────────────
// Called after a referred tech completes a job
// Increments their job count and pays referrer if threshold hit
// ─────────────────────────────────────────────

async function onJobCompleted(completedTechId) {
  // Check if this tech was referred by someone
  const referralResult = await db.query(
    `SELECT r.*, rs.jobs_threshold, rs.reward_paise,
            t.phone AS referrer_phone, t.name AS referrer_name
     FROM referrals r
     JOIN referral_schemes rs ON rs.id = r.scheme_id
     JOIN technicians t ON t.id = r.referrer_id
     WHERE r.referred_id = $1`,
    [completedTechId]
  );
  const referral = referralResult.rows[0];
  if (!referral) return;

  // Increment job count
  const newCount = referral.jobs_completed + 1;
  await db.query(
    `UPDATE referrals SET jobs_completed = $1 WHERE id = $2`,
    [newCount, referral.id]
  );

  // Check if a new reward threshold has been crossed
  const newRewardsPaid = Math.floor(newCount / referral.jobs_threshold);
  if (newRewardsPaid > referral.rewards_paid) {
    const rewardsToPay = newRewardsPaid - referral.rewards_paid;
    const totalPaise = rewardsToPay * referral.reward_paise;

    // Update rewards_paid count
    await db.query(
      `UPDATE referrals SET rewards_paid = $1 WHERE id = $2`,
      [newRewardsPaid, referral.id]
    );

    // Create ledger entry for referral bonus
    await db.query(
      `INSERT INTO ledger_entries (technician_id, type, amount_paise)
       VALUES ($1, 'referral_bonus', $2)`,
      [referral.referrer_id, totalPaise]
    );

    // Notify referrer
    await wa.sendText(referral.referrer_phone,
      `🎉 *Referral Bonus Earned!*\n\n` +
      `Your referred technician has completed ${newCount} jobs!\n\n` +
      `💰 *₹${totalPaise / 100} referral bonus* added to your account.\n` +
      `_(Will be settled in your next payout)_`
    );

    console.log(`[REFERRAL] Bonus ₹${totalPaise / 100} credited to ${referral.referrer_id} for ${rewardsToPay} threshold(s)`);
  }
}

// ─────────────────────────────────────────────
// Admin: update referral scheme
// ─────────────────────────────────────────────

async function updateScheme(jobsThreshold, rewardRs, notes) {
  // Deactivate current scheme
  await db.query(`UPDATE referral_schemes SET is_active = false`);

  // Insert new active scheme
  const result = await db.query(
    `INSERT INTO referral_schemes (jobs_threshold, reward_paise, is_active, notes)
     VALUES ($1, $2, true, $3) RETURNING *`,
    [jobsThreshold, rewardRs * 100, notes]
  );
  return result.rows[0];
}

module.exports = { handleRefer, saveReferral, onJobCompleted, updateScheme, getActiveScheme, ensureReferralCode };
