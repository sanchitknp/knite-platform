/**
 * Media Service
 *
 * Downloads media from Meta WhatsApp Cloud API and stores it:
 *   NODE_ENV=development  → local disk at /app/uploads/, served at /uploads/
 *   NODE_ENV=production   → AWS S3
 */
const fs = require('fs');
const path = require('path');

const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const IS_PROD = process.env.NODE_ENV === 'production';

// ─── S3 config (prod only) ────────────────────────────────────────────────────
let s3Client = null;
if (IS_PROD) {
  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  } catch (e) {
    console.warn('[MEDIA] AWS SDK not installed — falling back to disk storage');
  }
}

// ─── Local disk config (dev) ──────────────────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Resolve media ID → download URL via Meta Graph API
// ─────────────────────────────────────────────────────────────────────────────
async function getMediaDownloadUrl(mediaId) {
  const res = await fetch(`https://graph.facebook.com/v25.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  const data = await res.json();
  if (!res.ok || !data.url) {
    throw new Error(`[MEDIA] Failed to get download URL for ${mediaId}: ${JSON.stringify(data)}`);
  }
  return { url: data.url, mimeType: data.mime_type || 'application/octet-stream' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Download the file bytes
// ─────────────────────────────────────────────────────────────────────────────
async function downloadMedia(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`[MEDIA] Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3a: Save to local disk (dev)
// ─────────────────────────────────────────────────────────────────────────────
function mimeToExt(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'video/mp4': 'mp4',
  };
  return map[mimeType] || 'bin';
}

async function saveToDisk(buffer, folder, filename) {
  const dir = path.join(UPLOAD_DIR, folder);
  ensureDir(dir);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  // Return public URL path (served by Express static middleware)
  return `/uploads/${folder}/${filename}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3b: Upload to S3 (prod)
// ─────────────────────────────────────────────────────────────────────────────
async function uploadToS3(buffer, folder, filename, mimeType) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const bucket = process.env.AWS_S3_BUCKET;
  const key = `${folder}/${filename}`;
  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }));
  return `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: download + store, return permanent URL
// folder: 'kyc' | 'proof' | 'issue'
// ─────────────────────────────────────────────────────────────────────────────
async function storeMedia(mediaId, folder, identifier) {
  if (!mediaId) return null;

  console.log(`[MEDIA] Downloading mediaId=${mediaId} folder=${folder}`);
  const { url, mimeType } = await getMediaDownloadUrl(mediaId);
  const buffer = await downloadMedia(url);
  const ext = mimeToExt(mimeType);
  const filename = `${identifier}_${Date.now()}.${ext}`;

  if (IS_PROD && s3Client) {
    const s3Url = await uploadToS3(buffer, folder, filename, mimeType);
    console.log(`[MEDIA] Uploaded to S3: ${s3Url}`);
    return s3Url;
  } else {
    const localPath = await saveToDisk(buffer, folder, filename);
    console.log(`[MEDIA] Saved to disk: ${localPath}`);
    return localPath;
  }
}

module.exports = { storeMedia };
