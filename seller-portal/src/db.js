// Postgres pool for the Seller Service Portal.
// Connects to the SAME Cloud SQL instance as Knite, but as the dedicated
// least-privilege `ssp` DB user (see DATABASE_URL in the portal's .env).
// The portal's tables live in its own `ssp_app` schema.
const { Pool } = require('pg');

let connectionString =
  process.env.DATABASE_URL ||
  'postgresql://ssp:ssp_dev_secret@localhost:5432/knite';

// Newer pg/pg-connection-string treat `sslmode=require` as `verify-full`, which
// fails against Cloud SQL's cert chain ("unable to verify the first certificate").
// We manage TLS ourselves below, so strip any sslmode param from the URL.
connectionString = connectionString
  .replace(/([?&])sslmode=[^&]*/gi, '$1')
  .replace(/[?&]+$/,'')
  .replace(/\?&/, '?');

const isLocal = /@(localhost|127\.0\.0\.1)\b/i.test(connectionString);
// Cloud SQL: encrypt but don't verify the chain (no bundled CA). Local: no SSL.
const ssl = isLocal ? false : { rejectUnauthorized: false };

// Pin the portal's own schema at connection startup (before any query runs), so
// every table resolves to `ssp_app` regardless of the role's default search_path.
const SCHEMA = (process.env.SSP_SCHEMA || 'ssp_app').replace(/[^a-z0-9_]/gi, '');

const pool = new Pool({
  connectionString,
  ssl,
  options: `-c search_path=${SCHEMA},public`,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
});

pool.on('error', (err) => console.error('[DB] unexpected error', err));

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
