/**
 * One-time script: creates the "Pending Jobs" WhatsApp Flow in Meta and
 * uploads the JSON. Run from backend/:
 *
 *   node scripts/create_pending_jobs_flow.js
 *
 * On success it prints the flow ID — add it to .env as WA_FLOW_PENDING_JOBS.
 * After testing, publish with the printed curl command.
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env manually (no dotenv dependency needed)
const envPath = path.join(__dirname, '../.env');
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});

const WABA_ID = process.env.WABA_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL;

if (!WABA_ID || !ACCESS_TOKEN || !PUBLIC_URL) {
  console.error('Missing WABA_ID, WHATSAPP_ACCESS_TOKEN, or PUBLIC_URL in .env');
  process.exit(1);
}

const ENDPOINT_URI = `${PUBLIC_URL}/api/flow-exchange`;
const FLOW_JSON_PATH = path.join(__dirname, '../pending_jobs_flow.json');

// ─── helpers ────────────────────────────────────────────────────────────────

function jsonRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'graph.facebook.com',
        path: `/v25.0/${endpoint}`,
        method,
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => resolve(JSON.parse(buf)));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function multipartUpload(flowId, fileContent) {
  return new Promise((resolve, reject) => {
    const boundary = `----WaBoundary${crypto.randomBytes(8).toString('hex')}`;

    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nflow.json\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="asset_type"\r\n\r\nFLOW_JSON\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="flow.json"\r\nContent-Type: application/json\r\n\r\n${fileContent}\r\n`,
      `--${boundary}--\r\n`,
    ];
    const body = Buffer.from(parts.join(''));

    const req = https.request(
      {
        hostname: 'graph.facebook.com',
        path: `/v25.0/${flowId}/assets`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => resolve(JSON.parse(buf)));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const flowJson = fs.readFileSync(FLOW_JSON_PATH, 'utf8');

  // 1. Create flow
  console.log('Creating flow...');
  const created = await jsonRequest('POST', `${WABA_ID}/flows`, {
    name: 'Pending Jobs',
    categories: ['OTHER'],
    endpoint_uri: ENDPOINT_URI,
  });

  if (!created.id) {
    console.error('❌ Create failed:', JSON.stringify(created, null, 2));
    process.exit(1);
  }
  const flowId = created.id;
  console.log(`✅ Flow created: ${flowId}`);

  // 2. Upload JSON
  console.log('Uploading flow JSON...');
  const uploaded = await multipartUpload(flowId, flowJson);
  console.log('Upload response:', JSON.stringify(uploaded, null, 2));

  if (uploaded.validation_errors?.length) {
    console.error('❌ Validation errors — fix pending_jobs_flow.json and re-run:');
    console.error(JSON.stringify(uploaded.validation_errors, null, 2));
    process.exit(1);
  }

  // 3. Done
  console.log('\n══════════════════════════════════════════');
  console.log('Add to backend/.env:');
  console.log(`  WA_FLOW_PENDING_JOBS=${flowId}`);
  console.log('\nThen restart the backend:');
  console.log('  docker compose restart backend');
  console.log('\nAfter testing end-to-end, publish the flow:');
  console.log(`  curl -X POST "https://graph.facebook.com/v25.0/${flowId}/publish" \\`);
  console.log(`    -H "Authorization: Bearer ${ACCESS_TOKEN}"`);
  console.log('══════════════════════════════════════════');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
