# AXIOS ENTERPRISE LLP — Knite
## Application for DPIIT Recognition & Section 80-IAC Certification

**LLPIN:** ACX-2874 &nbsp;·&nbsp; **PAN:** ACOFA0039R &nbsp;·&nbsp; **TAN:** DELA88512E
**Date of Incorporation:** 17 April 2026
**Registered Office:** Malviya Nagar, New Delhi — 110017
**Operating Office:** Kanpur, Uttar Pradesh — 208001
**Website:** *[to be finalised]*

---

## Cover Summary

AXIOS ENTERPRISE LLP is an Indian limited liability partnership incorporated on 17 April 2026, operating under the product brand **Knite** — a WhatsApp-native operating system for India's 1.8 million field technicians. The LLP is wholly owned by its two Designated Partners, Sanchit Agarwal (IIT Kanpur, 50%) and Anmol Kumar Shrivastava (IIT BHU, 50%), both experienced software engineers working in applied AI.

Knite eliminates the single biggest barrier to digitising India's home-services aftermarket: app adoption. Every technician workflow — onboarding, KYC, job dispatch, navigation, customer verification, and payout — is delivered inside a single WhatsApp thread using encrypted WhatsApp Cloud API Flows. Customers get a trust-first booking experience. Brands get real-time SLA and NPS visibility via API and dashboard.

This document contains the innovation write-up required for DPIIT Startup India recognition and the product narrative required for Section 80-IAC certification by the Inter-Ministerial Board.

---

## Section A — Innovation Write-Up

### A.1 What is the problem the startup is solving?

India's ~₹1.2 lakh-crore home-appliance and smart-device aftermarket runs on an informal network of more than **1.8 million field technicians** who install, repair, and service everything from geysers and air-conditioners to CCTV kits, water purifiers, and solar inverters. The market is plagued by three structural failures:

**(a) Customer trust has collapsed.** Brands and marketplaces ship products but outsource the "last-metre" installation to third-party agencies. Customers face no-shows, inflated on-site quotes, unverified technicians, and no effective redressal — driving installation review scores below 3★ on every major e-commerce platform.

**(b) Technician economics are broken.** A typical installer earns ₹8,000–₹20,000 per month, receives jobs through WhatsApp forwards from four or five competing aggregators, has no fixed schedule, waits 30–60 days for payment, and has zero structured upskilling path. In our primary field research across Kanpur and Lucknow (February–April 2026), 62% of technicians surveyed had never used a smartphone application beyond WhatsApp and Google Pay.

**(c) Brands fly blind.** OEMs and D2C sellers cannot observe installation SLAs, first-time-fix rates, or customer feedback at the job level. They cannot enforce quality, cannot attribute warranty failures to field causes, and cannot learn from patterns across pincodes or product lines.

Existing "technician apps" — Urban Company, NoBroker Services, Zimmber, and several B2B dashboard SaaS products — all require Android application downloads, Play Store accounts, continuous 4G data, and literacy with complex multi-screen interfaces. As a consequence, adoption among Tier-2 and Tier-3 technicians — where roughly 80% of installation volume actually sits — is negligible.

### A.2 How does your startup propose to solve this problem?

Knite is a **WhatsApp-native field-service operating system**. Technicians never install an app. Every interaction — onboarding, KYC, job assignment, navigation, customer verification, and payout — happens inside a single WhatsApp thread with our business number, powered by **WhatsApp Cloud API Flows** (v5.1).

A technician receives a job as a rich WhatsApp message with a tap-through flow: they see the full job card (address, customer contact, slot, payout), tap "Get Directions" (which sends a location pin and Google Maps deep-link into the same chat), tap "I Have Arrived" to start the SLA clock, and finally enter a 6-digit **Happiness Code** that the customer received at the time of booking. Entering the correct code closes the job, releases payment within 24 hours, and triggers a customer-satisfaction poll — also delivered on WhatsApp.

On the brand side, Knite is a multi-tenant SaaS platform: OEMs, marketplaces, and service franchises integrate through a REST API or via CSV upload, and receive a live dashboard with first-time-fix rate, mean time to arrive, technician-level NPS, and pincode-level heatmaps.

The moat is **operational, not cosmetic**. Knite is building the first country-scale technician graph that is reachable *without* an app — addressable in 22 Indian languages through WhatsApp's native language support, trainable via short WhatsApp audio and video lessons, and rate-able by customers inside the same thread that booked the job. Every completed job enriches the graph with location, product-category, failure-mode, and customer-feedback data — creating a compounding data asset for brand partners.

### A.3 What is the uniqueness of your solution?

Three innovations make Knite defensible:

**1. Zero-app technician onboarding.** Competing platforms require Android 9 or higher, a 200 MB install, Play Store sign-in, and continuous data. Knite onboards a technician with a single WhatsApp "Hi" — KYC upload (Aadhaar, PAN, bank proof), bank linking, training videos, and job dispatch all happen inside chat. Based on our pilot cohort in Kanpur, this expands the addressable technician base by approximately four times relative to app-based competitors.

**2. Encrypted WhatsApp Flows with stateful data exchange.** Knite uses WhatsApp Flows v5.1 with RSA-2048 public-key cryptography and AES-128-GCM symmetric encryption for every data-exchange round-trip, combined with a custom Redis-backed session state machine that renders dynamic, multi-screen experiences (pending-jobs list → job detail → OTP verification → completion) without ever leaving the WhatsApp thread. We believe Knite is among the earliest Indian platforms to apply WhatsApp Flows to an end-to-end job lifecycle, not merely to lead capture or single-form intake.

**3. The Happiness Code — trust as a primitive.** A 6-digit code is issued to the customer at the moment of booking, stored in the Knite backend as a bcrypt-hashed value, and verifiable only by the technician assigned to that specific job at the customer's doorstep. This replaces paper job sheets, structurally prevents fraudulent "ghost closures" by technicians, is tamper-evident in our database audit log, and is observable by brand partners in real time. The Happiness Code will be commercially proven first on our own flagship product — **Knite Pure+ (Mineral Edition)**, a 7-stage RO water purifier — and then extended to third-party brands. It is the first verifiable, low-friction proof of physical service delivery that works without an app on either side.

Combined, these three innovations give Knite a structurally lower customer-acquisition cost, dramatically higher technician retention, and a proprietary data asset that improves monotonically with every completed job.

---

## Section B — Business & Market Narrative

### B.1 Why now

Three conditions have aligned in 2025–26 that make Knite possible today, but were not possible eighteen months ago:

- **WhatsApp Cloud API + Flows (v5.1)**, released by Meta in early 2026, enables encrypted, multi-screen, stateful workflows inside chat. Prior versions supported only static message templates and simple buttons, which are insufficient for a multi-step field-service workflow.
- **UPI AutoPay and Aadhaar-based e-KYC** are now fully remote and API-accessible, removing the last paperwork barrier to onboarding informal-sector workers in minutes.
- **OEM margin compression** has pushed brands to unbundle installation from sale and seek third-party operators who can guarantee SLAs — historically a gap in the market.

### B.2 Market sizing

| Horizon | Definition | Size |
|---|---|---|
| **TAM** | India aftermarket + installation services across all categories | ≈ ₹1.2 lakh crore / year |
| **SAM** | Home-services categories addressable via WhatsApp in top 50 cities | ≈ ₹18,000 crore / year |
| **SOM (Year 3)** | Knite's targeted GMV capture in 50 cities across priority categories (CCTV, solar, water purifier, geyser, air-conditioner) | ≈ ₹240 crore |

### B.3 Go-to-market

Knite's go-to-market is deliberately sequenced to build category depth before breadth. Instead of launching as a horizontal platform and chasing brand partnerships cold, we are first launching our own consumer product, using it to stress-test the WhatsApp-native operating system at real scale, and simultaneously building a proprietary, certified technician network in a single high-volume category — RO water purifiers.

- **Phase 1 (2026) — Launch Knite Pure+ (Mineral Edition); prove the platform on our own product.** We will launch our in-house flagship product, **Knite Pure+ (Mineral Edition)**, a 7-stage RO water purifier featuring a Powerflow 100 GPD pump, RO membrane, UV-C Pure Cycle, Ultrafiltration, Active Carbon Matrix, Minerals + Copper stage, and pH balancing — delivering safe, mineral-balanced drinking water for Indian households. Every Knite Pure+ unit sold will be installed, AMC-serviced, and filter-replaced through the WhatsApp-native Knite technician flow. This phase delivers three compounding advantages: (i) a live, at-scale production deployment of the WhatsApp Flows stack on a real consumer SKU; (ii) a growing, vetted database of RO-specialist technicians with verified KYC, training history, and customer-NPS track record; and (iii) first-party revenue from purifier sales plus recurring AMC, funding the platform build-out without external capital dependency.
- **Phase 2 (2027) — Open the platform to third-party RO brands.** With a proven WhatsApp workflow and a certified RO technician network already in place, we will sign up established RO manufacturers and distributors as tenants on the Knite platform for their installation, AMC, and service needs. For these partners, Knite reduces installation no-show rates, eliminates technician onboarding overhead, and gives them real-time SLA and NPS dashboards — without their having to build any of it themselves.
- **Phase 3 (2028 and beyond) — Generalise across product categories.** Once the RO vertical is saturated, we will extend the Knite platform horizontally to adjacent installation and maintenance categories — air-conditioners, geysers, CCTV, solar inverters, kitchen appliances, and smart-home devices — reusing the same WhatsApp Flows, Happiness Code, and brand-dashboard layers. At this stage Knite becomes a category-agnostic field-services operating system for India, available in 22 Indian languages.

---

## Section C — Product Pitch Narrative

### C.1 Title

**Knite — The WhatsApp-native operating system for India's 1.8 million field technicians.**
AXIOS ENTERPRISE LLP · New Delhi & Kanpur · April 2026.

### C.2 The problem in one paragraph

India installs roughly 40 million appliances and connected devices every year. Almost every installation is carried out by a technician who got the job via WhatsApp forwarding, does not use a smartphone application, and is paid 30–45 days late. Customers complain. Brands are blind. Technicians stay poor.

### C.3 The product

Knite is built as two integrated layers — a consumer hardware product and the software platform that services it.

**C.3.1 Hardware — Knite Pure+ (Mineral Edition).** Our flagship consumer product is a 7-stage RO water purifier designed for Indian households. Filtration stages: RO membrane · UV-C Pure Cycle · Ultrafiltration (UF) · Active Carbon Matrix · Minerals + Copper · pH balance · TDS controller. Core pump: Powerflow 100 GPD. Knite Pure+ is the first mass-market RO purifier in India designed from day one around a zero-app, WhatsApp-native installation and service workflow.

**C.3.2 Software — the Knite platform.** Three surfaces:

1. **Technician surface** — 100% WhatsApp-delivered, zero-app, available in 22 Indian languages.
2. **Customer surface** — booking, live tracking, Happiness Code delivery, and CSAT collection, all on WhatsApp.
3. **Brand surface** — REST API, CSV upload, and a SaaS dashboard reporting first-time-fix rate, mean time to arrive, and technician-level NPS.

### C.4 How it works — the technician journey

> **Booking → Assignment → Directions in chat → "I Have Arrived" → Happiness Code → Auto-payout.**
> Four taps, one thread, no app.

### C.5 Innovation & IP

- Encrypted WhatsApp Flows (RSA-2048 + AES-128-GCM) with stateful data exchange for full multi-screen job lifecycle inside chat.
- Happiness Code — bcrypt-hashed, customer-issued, technician-verified 6-digit OTP as a platform-level trust primitive.
- Session state machine capable of surviving chat → flow → chat handoffs without context loss.

### C.6 Team

- **Sanchit Agarwal** — Designated Partner & CTO. Experienced software engineer in AI, graduated from IIT Kanpur. Builds and owns Knite's backend, WhatsApp Flows, and data platform. DIN: 11668712.
- **Anmol Kumar Shrivastava** — Designated Partner & COO. Experienced software engineer in AI, graduated from IIT (BHU) Varanasi. Leads technician onboarding, field operations, and brand partnerships. DIN: 11668713.
- **Sahar Rizvi, CA** — Finance and compliance facilitator (external advisor, not a partner).

### C.7 Ask

AXIOS ENTERPRISE LLP seeks DPIIT Startup India recognition and Section 80-IAC certification. The resulting three-year tax holiday (on any three consecutive assessment years within the first ten from incorporation) will be redirected into technician training, vernacular content production, and Tier-2 and Tier-3 city expansion — directly furthering the Startup India mandate to create scalable employment and wealth in under-served geographies.

---

## Section D — Declarations

The LLP hereby declares that:

1. It is a Limited Liability Partnership incorporated under the Limited Liability Partnership Act, 2008, on 17 April 2026, bearing LLPIN **ACX-2874**.
2. It has not completed ten years from the date of its incorporation as of the date of this application.
3. Its turnover has not exceeded ₹100 crore in any financial year since incorporation (entity is in its first financial year).
4. It is working towards innovation, development, or improvement of products, processes, or services, and has a scalable business model with high potential for employment generation and wealth creation, as demonstrated in Sections A, B, and C above.
5. It has not been formed by splitting up or reconstruction of a business already in existence.
6. All information provided in this application and in supporting documents is true and correct to the best of the knowledge and belief of the undersigned.

For and on behalf of **AXIOS ENTERPRISE LLP**

&nbsp;

____________________________              ____________________________
**Sanchit Agarwal**                                              **Anmol Kumar Shrivastava**
Designated Partner                                              Designated Partner
DIN: 11668712                                                      DIN: 11668713

Place: New Delhi
Date: _____ / _____ / 2026

---

*End of document.*
