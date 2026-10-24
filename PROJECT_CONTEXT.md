# Knite project context

Last updated: 25 October 2026 (India time).

This is the shared handoff document for contributors. Read it before planning or changing the platform. Keep current facts here and append completed work to the activity log below. The older README describes the initial MVP and is not a complete description of production.

## Maintaining this document

- Fetch the latest branch and read this file before starting work; reconcile concurrent changes before pushing.
- Update this file in the same commit or pull request as relevant code, configuration, deployment, or operational changes.
- Record what changed, why, validation performed, deployment status, and remaining work. Record investigations even if no code changes result.
- Distinguish observed production behavior, repository implementation, assumptions, and proposed work. Date production observations because they can become stale.
- Keep the current-state sections accurate; use the activity log for history. Never mark a proposed change as deployed without verification.
- Do not commit credentials, access tokens, customer details, order IDs, evidence images, or personal account information. This repository is public.
- This document is the canonical team context; personal chat histories and machine-local notes are not the shared source of truth.

## Product and priorities

Knite is an Indian RO water purifier brand operated by Axios Enterprise LLP. The public site at https://knite.in provides product information, marketplace purchase links, direct shopping, and installation/support intake. Operations are managed at https://knite.in/admin.

The team's frequently used workflows are installation service, technician assignment, customer review requests, locating customers who did not supply a map pin, and Amazon SAFE-T claim evidence tracking. The immediate objective is to understand and improve these workflows; no new feature roadmap has been agreed yet.

## Current operational workflows

### Installation requests

- Customers register at https://knite.in/support. Support tickets are a separate intake option.
- Requests capture customer contact, product, purchase channel, address, city/state/pincode, coordinates, and status.
- Statuses: `new`, `contacted`, `scheduled`, `installed`, `cancelled`. The active view groups the first three.
- Admin can find service providers, search nearest technicians, or enter a custom technician. Custom technicians are retained for reuse.
- Assignments record technician details, source, assigning admin, and time. Assigning a new/contacted request moves it to scheduled.
- Installation charges and separate customer/technician message languages can be saved per installation.
- Assignment produces a prefilled WhatsApp link with job and customer details; the operator sends the message.

### Customer location

- A customer-dropped map pin is distinguished from address geocoding and a pincode-area centre.
- Admin can use Locate to derive coordinates when missing.
- Labels: `Pin` (customer-provided), `Approx~` (address-derived), `Area~` (pincode centre).
- Approximate coordinates support technician discovery but do not establish a precise doorstep location.

### Communications and reviews

- Communications provides Notify Customer, Ask Status, and Review actions per installation, with pending/sent markers.
- Saved language preferences are reused.
- Review requests confirm the product and generate an Amazon review URL from its ASIN mapping.
- The frontend records communication timestamps when opening the WhatsApp flow. These markers do not verify delivery, reading, or actual review submission.

### Amazon SAFE-T claims

- The admin UI calls this Safety Claims. It concerns marketplace returns, separate from customer warranty/support claims.
- An operator saves Amazon order ID, return photos, and optional notes while waiting until filing is possible after refund initiation.
- The operator downloads an evidence ZIP, files externally on Amazon, and marks the local record Filed. Pending/filed filters support follow-up.
- The inspected workflow does not automatically file claims or track Amazon adjudication.
- Metadata is stored in PostgreSQL; images are stored on the VM filesystem and served through authenticated endpoints. Configured image retention is 60 days as of the deployment inspection below.

## Other platform areas

Units, Jobs, Technicians, Customers, Maintenance, Ledger, Zones, Website Leads, Support Tickets, Coverage Map, Shop Products, Shop Orders, and Admin Users are also available.

Older automated WhatsApp unit/job flows include technician broadcasting, OTP verification, photo proof, customer confirmation, maintenance reminders, and payouts. These jobs are distinct from the newer admin installation-request records. Historical/demo dashboard records have not been validated as business KPIs.

## Repository and implementation

- Repository: https://github.com/sanchitknp/knite-platform.
- At inspection, GitHub default `main` contains the April MVP. `master` contains the newer implementation; use it as the baseline for current work unless the team changes branch policy.
- Implementation baseline inspected: `master` at `c533e8d` (23 October 2026).
- Backend: Node.js/Express. Database: PostgreSQL. Frontend: vanilla HTML/JavaScript. Scheduled jobs: node-cron. Compose includes Redis.
- Integration areas include Meta WhatsApp APIs, operator-sent WhatsApp links, geocoding/service-provider discovery, translation, Amazon review links, and direct shopping.
- Main files: `frontend/admin.html`, `backend/server.js`, `backend/src/controllers/supportController.js`, `backend/src/controllers/safetyClaimsController.js`, `backend/src/services/geocoder.js`, `backend/src/db/support_schema.sql`.
- The repository contains both a GCP Compose overlay and older AWS EC2/RDS Terraform/deployment scripts. Do not run an old deployment script assuming it represents current production.

## Deployment context

The project includes a GCP Compose overlay and an older AWS deployment path. Confirm the intended environment and approved deployment process with the team before executing either. Environment identifiers, access details, operational measurements, and security configuration belong in an access-controlled operations record, not this public document.

An authorized deployment inspection was completed on 25 October 2026. This public document records its scope without publishing infrastructure details. Deployment verification does not establish parity for files that were not compared.

## Open items before deployment changes

- Confirm recovery procedures for both database records and filesystem evidence before deployment changes.
- Reconcile all relevant deployed files before relying on the repository as a complete production copy.
- Check dependencies and co-hosted workloads before planning host restarts or resource changes.
- Agree the next feature/change priorities with the team.

## Activity log

### 25 October 2026 — Initial context and deployment inspection

- Reviewed the live public site, authenticated admin portal, and repository to map the team's primary workflows.
- Identified the `main`/`master` divergence and checked out the current `master` implementation.
- Installed Google Cloud CLI locally and completed an authorized deployment inspection.
- Inspected deployment configuration and compared selected source files; detailed operational findings remain in the local inspection note for transfer to an access-controlled team record.
- No application update, service restart, customer message, business-record mutation, or cloud API enablement was performed.
- Outcome: workflow context established; deployment and recovery checks remain prerequisites for subsequent changes.

### 25 October 2026 — Shared context documentation

- Added this document as the canonical team handoff and linked it from the README.
- Defined the ongoing update convention above so investigations and changes travel with the repository.
- Validation: documentation diff and whitespace checks; no runtime changes or deployment required.
