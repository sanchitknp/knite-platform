const bcrypt = require('bcryptjs');

/**
 * Generate a 6-digit OTP
 */
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Hash OTP for storage
 */
async function hashOTP(otp) {
  return bcrypt.hash(otp, 8);
}

/**
 * Verify OTP against hash
 */
async function verifyOTP(otp, hash) {
  return bcrypt.compare(otp, hash);
}

module.exports = { generateOTP, hashOTP, verifyOTP };
