const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgresql://knite:knite_secret@localhost:5432/knite';

// RDS enforces SSL by default (rds.force_ssl=1). Detect by host and enable SSL
// without CA verification — sufficient for the pilot; for stricter setups,
// bundle the RDS global CA bundle and set rejectUnauthorized: true.
const needsSSL =
  process.env.PGSSLMODE === 'require' ||
  /rds\.amazonaws\.com/i.test(connectionString);

const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ...(needsSSL ? { ssl: { rejectUnauthorized: false } } : {}),
});

pool.on('error', (err) => {
  console.error('Unexpected DB error', err);
});

const query = (text, params) => pool.query(text, params);

const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
