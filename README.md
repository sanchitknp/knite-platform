# Knite RO Fulfillment Platform — MVP

WhatsApp-native zero-touch RO installation, support & maintenance platform.

## Current project context

Read [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for the current workflows, deployment guidance, open items, and team activity log. Update it alongside relevant changes and investigations. The sections below describe the initial MVP; the current implementation is on `master`, while the GitHub default `main` branch is older.

## Architecture

```
knite-platform/
├── docker-compose.yml         # PostgreSQL + Redis + Backend
├── backend/                   # Node.js Express API
│   ├── server.js              # Entry point
│   └── src/
│       ├── db/                # Schema + seed data
│       ├── services/flows/    # 5 conversation flows
│       ├── controllers/       # Webhook + Admin API
│       └── jobs/              # CRON jobs
└── frontend/
    ├── simulator.html         # WhatsApp chat simulator
    └── admin.html             # Admin operations dashboard
```

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+ (if running locally without Docker)

### 1. Start with Docker (Recommended)

```bash
cd knite-platform
docker-compose up --build
```

Wait ~30 seconds for PostgreSQL to initialize and backend to connect.

### 2. Open the Apps

| App | URL |
|-----|-----|
| WhatsApp Simulator | http://localhost:3000/simulator.html |
| Admin Dashboard | http://localhost:3000/admin.html |
| API Health | http://localhost:3000/api/health |

---

## Local Development (without Docker)

### 1. Start PostgreSQL (requires local Postgres)

```bash
createdb knite
psql knite < backend/src/db/schema.sql
psql knite < backend/src/db/seed.sql
```

### 2. Install & Start Backend

```bash
cd backend
npm install
DATABASE_URL=postgresql://localhost/knite WHATSAPP_MODE=simulator npm run dev
```

### 3. Open Simulator
Open `frontend/simulator.html` directly in a browser (or serve it).

---

## Test Flows

### Flow 1: Zero-Touch Installation

**Participant:** Priya Sharma (919876543210) — Customer

1. Open **simulator.html**, select "Priya Sharma"
2. Click quick-action: **📦 Install KN-8492**
3. System registers unit, asks for address
4. Reply: `Flat 402, Tower B, Supertech Capetown, Sector 74, Noida 201301`
5. System finds zone, shows slot options
6. Tap: **🌅 Tomorrow 9-11 AM** (or ASAP)
7. System creates job, generates OTP, sends confirmation

**Then switch to technician:**
1. Select "Ramesh Kumar (Demo Tech)" (918888888888)
2. After broadcast: tap **✅ Accept Job**
3. System notifies customer, gives address to tech
4. Tap **📍 I Have Arrived**
5. Enter the OTP shown in customer's chat
6. Send 2 "photos" (click 📷 twice)
7. Customer gets verification prompt → tap **✅ Yes, All Good!**

### Flow 2: Customer Support

1. Select any customer with an active unit
2. Type: `leak` or `help`
3. Select issue type → send photo (📷)
4. Choose slot → technician dispatched

### Flow 3: Technician Onboarding

1. Add new participant: phone `916666666666`, role: Technician
2. Click **🔧 Register Tech** quick action
3. Follow the registration flow (name → zone → KYC photo)
4. Switch to Admin (919999999999) → receive approval notification
5. Tap **✅ Approve** in admin chat
6. Switch back to new tech → confirmation received

### Flow 4: Ownership Transfer

1. Priya (919876543210) has KN-8492 registered
2. Add new customer: `917654321098`
3. Send: `Install KN-8492`
4. System detects it's registered → offers TRANSFER
5. Original owner (Priya) gets notification → taps YES
6. New customer continues with installation

### Flow 5: Recurring Maintenance (Manual Trigger)

1. After completing an installation (unit goes "active")
2. In Admin Dashboard → Maintenance → **▶️ Trigger Check Now**
3. Or call: `POST http://localhost:3000/api/admin/trigger/maintenance`
4. Customer receives filter replacement reminder

---

## Admin Dashboard Features

- **Overview**: Live stats — units, jobs, techs, pending maintenance
- **Units**: Full lifecycle tracking with event history
- **Jobs**: View/manage all jobs, force-broadcast, resolve disputes
- **Technicians**: Approve/reject KYC applications, activate/deactivate
- **Customers**: All registered users
- **Maintenance**: Upcoming filter replacements, manual trigger
- **Ledger**: Technician payout tracking, mark settled
- **Zones**: Delhi NCR service coverage

---

## Pre-seeded Data

| Type | Value | Description |
|------|-------|-------------|
| Units | KN-8492, KN-7201, KN-1337, KN-0042, KN-5500 | Ready to register (status: shipped) |
| Tech 1 | 918888888888 | Ramesh Kumar — Noida zone (approved) |
| Tech 2 | 917777777777 | Suresh Sharma — Gurgaon zone (approved) |
| Admin | 919999999999 | Admin user for approvals |
| Zones | 10 Delhi NCR zones | With pincode coverage |

---

## CRON Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Slot Broadcast | Every 5 min | Broadcast scheduled jobs 30min before slot |
| Broadcast Expiry | Every 5 min | Expire unaccepted broadcasts, escalate to admin |
| Auto-Complete | Every hour | Auto-complete pending_verification after 4hr |
| Maintenance | Daily 10 AM | Send filter replacement reminders |

---

## API Reference

### Simulator
```
POST /api/simulate          Send a message as a phone number
GET  /api/messages/:phone   Poll for system responses
```

### Admin
```
GET  /api/admin/stats              Dashboard stats
GET  /api/admin/units              All units
POST /api/admin/units              Seed new unit
GET  /api/admin/jobs               All jobs
POST /api/admin/jobs/:id/broadcast Force broadcast
POST /api/admin/jobs/:id/dispute   Resolve dispute
GET  /api/admin/technicians        All technicians
POST /api/admin/technicians/:id/approve  Approve/reject
GET  /api/admin/maintenance        Maintenance schedules
POST /api/admin/trigger/maintenance  Manual trigger
GET  /api/admin/ledger             Payout ledger
POST /api/admin/ledger/:techId/settle  Mark settled
```

---

## Anti-Fraud (Implemented)

1. **Address hidden in broadcast** — Only pincode/zone shown, full address after acceptance
2. **OTP verification** — Bcrypt-hashed, required before job starts
3. **Photo proof** — 2 photos required before completion
4. **Customer verification** — YES/NO after tech submits photos
5. **Auto-deactivate** — 3 disputes in 30 days → tech deactivated
6. **Immutable event log** — Full audit trail for every unit and job

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Node.js + Express |
| Database | PostgreSQL 15 |
| Cache | Redis 7 |
| WhatsApp | Meta Cloud API (simulator mode locally) |
| CRON | node-cron |
| Frontend | Vanilla HTML/JS (zero build step) |
| Container | Docker Compose |
