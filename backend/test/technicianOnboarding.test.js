const { test } = require('node:test');
const assert = require('node:assert/strict');
const dbPath = require.resolve('../src/db');
let query;
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
  exports: { query: (...args) => query(...args) } };
const { validateApplication, registerTechnician, createSubmissionLimiter } = require('../src/controllers/technicianOnboardingController');

const application = () => ({ name: 'Test Technician', phone: '+91 98765 43210',
  address: 'Test service address 123', city: 'New Delhi', state: 'Delhi',
  google_maps_link: 'https://maps.app.goo.gl/ExampleOnly',
  coverage_pincodes: '110002, 110001 110002', consent: true });
function response() {
  return { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('normalizes an Indian phone and deduplicates exact coverage', () => {
  const { data, errors } = validateApplication(application());
  assert.deepEqual(errors, {});
  assert.equal(data.phone, '919876543210');
  assert.deepEqual(data.coverage_pincodes, ['110001', '110002']);
});

test('rejects malformed payloads, partial pincodes, foreign phones, missing consent and excessive coverage', () => {
  for (const value of [null, [], 'hello', 1]) assert.ok(Object.keys(validateApplication(value).errors).length);
  for (const value of ['110001, 123', '011001', '110001x', [], [110001], Array(101).fill('110001')]) {
    assert.ok(validateApplication({ ...application(), coverage_pincodes: value }).errors.coverage_pincodes);
  }
  for (const value of ['+1 9876543210', '1234567890', {}, '9876543210abc']) {
    assert.ok(validateApplication({ ...application(), phone: value }).errors.phone);
  }
  assert.ok(validateApplication({ ...application(), consent: 'true' }).errors.consent);
});

test('accepts Google share/pin links and rejects executable URLs and lookalike domains', () => {
  for (const link of ['https://www.google.com/maps?q=28.6,77.2', 'https://maps.google.com/?q=Delhi', 'https://goo.gl/maps/example']) {
    assert.equal(validateApplication({ ...application(), google_maps_link: link }).errors.google_maps_link, undefined);
  }
  for (const link of ['javascript:alert(1)', 'http://maps.google.com/', 'https://google.com.evil.test/maps',
    'https://maps.app.goo.gl.evil.test/test', 'https://www.google.com/search?q=Delhi', 'https://user:pass@maps.google.com/', 'https://goo.gl/elsewhere']) {
    assert.ok(validateApplication({ ...application(), google_maps_link: link }).errors.google_maps_link);
  }
});

test('creates a pending technician with parameterized fields and no privilege escalation', async () => {
  let params;
  query = async (sql, values) => { assert.match(sql, /'public_form',false,false/); params = values; return { rowCount: 1, rows: [{ id: 'private-id' }] }; };
  const res = response();
  await registerTechnician({ body: { ...application(), is_verified: true, is_active: true, rating: 5 } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.status, 'pending_review');
  assert.equal(res.body.id, undefined);
  assert.deepEqual(params[6], ['110001', '110002']);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('validation fails before writing to the database', async () => {
  query = () => { throw new Error('must not query'); };
  const res = response();
  await registerTechnician({ body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.fields.name);
});

test('duplicate applications cannot overwrite existing profiles', async () => {
  query = async sql => { assert.match(sql, /ON CONFLICT \(phone\) DO NOTHING/); return { rowCount: 0, rows: [] }; };
  const res = response();
  await registerTechnician({ body: application() }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.phone, undefined);
});

test('database errors return a generic retryable response', async () => {
  query = async () => { const error = new Error('private details'); error.code = 'TEST_ERROR'; throw error; };
  const res = response();
  await registerTechnician({ body: application() }, res);
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(res.body), /private details/);
});

test('submission throttling expires and supplies Retry-After', () => {
  let time = 0, calls = 0;
  const limiter = createSubmissionLimiter({ max: 1, windowMs: 1000, now: () => time });
  limiter({ ip: 'local' }, response(), () => calls++);
  const res = response();
  limiter({ ip: 'local' }, res, () => calls++);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['Retry-After'], '1');
  time = 1000;
  limiter({ ip: 'local' }, response(), () => calls++);
  assert.equal(calls, 2);
});
