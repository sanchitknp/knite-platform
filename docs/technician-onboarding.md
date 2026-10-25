# Technician signup

Status: implemented on the feature branch; not deployed by this change.

## Shareable form

After deployment, share `/technician-register` on the Knite domain. The admin Technicians section also links to the form. It works without an admin account and submits to the same origin.

Required fields: full name, Indian WhatsApp mobile number, business/service address, city/town, state/union territory, Google Maps location/share URL, service coverage pincodes, and permission to store the details and contact the applicant about onboarding/service work.

The form explains how to obtain a Maps share link. It preserves entries after errors, displays field-level validation, prevents double submission while a request is pending, and shows confirmation only after a successful API response. It does not collect Aadhaar, banking information, or location permission from the browser.

## API

`POST /api/technicians/register` accepts JSON without admin authentication:

```json
{
  "name": "Example Technician",
  "phone": "+91 98765 43210",
  "address": "Example service centre, Example Road",
  "city": "New Delhi",
  "state": "Delhi",
  "google_maps_link": "https://www.google.com/maps?q=28.6,77.2",
  "coverage_pincodes": ["110001", "110002"],
  "consent": true
}
```

`coverage_pincodes` may also be a comma/whitespace-separated string. All entries must be six-digit strings with a nonzero first digit; invalid entries reject the submission rather than being silently discarded. Up to 100 entries are accepted and duplicates are removed. Validation checks format, not postal-directory existence.

Mobile numbers are normalized to `91` plus ten digits. Accepted Maps URLs use HTTPS and recognized Google Maps hosts/paths. The server stores the link without fetching it or resolving shortened links; it does not derive coordinates or verify that the linked place is the applicant's address.

Responses:

- `201`: `{ "ok": true, "status": "pending_review", "message": "..." }`.
- `400`: invalid input, with `{ "error": "...", "fields": { "field_name": "..." } }`.
- `409`: the normalized phone already exists; no existing record is overwritten or returned.
- `429`: request allowance exceeded; `Retry-After` gives seconds to wait.
- `503`: storage is temporarily unavailable; internal errors are not returned.

The per-process limiter allows 60 attempts per connecting IP in ten minutes. It does not trust forwarded headers. Behind a reverse proxy, callers may share an allowance; deployments with multiple processes do not share limiter state. This is basic submission throttling, not phone ownership verification.

## Storage and admin review

Registrations are inserted into the existing `technicians` table with `registration_source='public_form'`, `is_active=false`, and `is_verified=false`. Fields supplied by the caller cannot activate or verify the technician. One parameterized INSERT stores the entire application, so partial profiles are not created.

The additive, repeatable migration in `backend/src/db/technician_onboarding_schema.sql` adds address, city, state, Google Maps link, coverage pincodes, registration source, and a GIN coverage index. Backend startup applies it before serving requests. Migration failure prevents startup from serving against a partial schema; run it in the intended environment and verify success before routing traffic to the new code.

Admin sees applications in Technicians and pending approvals, with address, Maps link and pincodes. Review contact/location/coverage before using the existing Approve action. That existing action activates the technician and may send its existing WhatsApp approval message; registration itself sends no message and does not prove phone ownership or complete KYC.

Approved applicants are matched using their exact submitted pincodes in installation discovery and job broadcasting. No shared zone is enlarged by a public registration. Existing technicians without explicit coverage retain their zone-based matching behavior. The Maps link is available for admin review; this change does not add applicants to the separate third-party provider nearest-distance search.

## Verification and rollout

- Run `cd backend && npm test` with Node 20 or newer for validation, duplicate handling, pending status, database error, and throttle tests.
- Before rollout, apply the SQL to a test database twice to verify repeatability; check existing zone-based technicians as well as an approved applicant's exact covered and uncovered pincodes.
- The implementation was additionally exercised against isolated PostgreSQL via PGlite with Express 4.18.3: migration twice, HTTP creation/invalid input/duplicate, pending exclusion, approval discovery, exact coverage, and legacy zone compatibility passed.
- Desktop browser QA exercised invalid pincode feedback and a successful application using synthetic data on a local test database. Responsive CSS is included; a physical mobile-device test remains a rollout check.
- Syntax and whitespace checks are required. No production records, approval messages, or live schema were changed during this verification.
- Coordinate rollout with other contributors and update `PROJECT_CONTEXT.md` with the deployed revision and verification outcome. Do not publish infrastructure or customer details in this public repository.
- Rollback: restore the previous application files; leave the additive columns/index in place to preserve registrations. Do not drop applicant data as part of application rollback.
