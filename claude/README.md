# KNITE Platform — Amazon.in Operations

Operating knowledge for the **KNITE** brand of RO water purifiers, sold on Amazon.in by
**Axios Enterprise LLP** (GSTIN `<GSTIN — see confidential reference>`, Malviya Nagar, New Delhi).

This repo exists so that catalogue work is repeatable by anyone on the team, without
re-deriving the same facts or repeating the same flat-file mistakes.

> Account identifiers and commercial performance are **not** in this repo.
> See [`CONFIDENTIAL.md`](CONFIDENTIAL.md).

## Contents

| Path | What it holds |
|---|---|
| `docs/01-catalogue.md` | Every SKU, ASIN, FNSKU and price |
| `docs/02-product-specs.md` | Stage counts, technology, warranty, dimensions |
| `docs/03-flat-file-playbook.md` | How to build an upload that passes first time |
| `docs/04-known-errors.md` | Every Amazon error code hit, and its fix |
| `docs/05-keywords.md` | Keyword sets and Brand Analytics findings |
| `docs/06-advertising.md` | Campaign structure, bids, what the data showed |
| `docs/07-fba-logistics.md` | Shipments, challan, e-way bill, labelling |
| `docs/08-brand-store.md` | Store build state and competitor analysis |
| `docs/09-images.md` | Drive structure and image hosting |
| `docs/10-open-issues.md` | Unresolved items |
| `docs/11-policy-boundaries.md` | What not to do, and why |
| `templates/` | Amazon flat-file templates, so they need not be re-downloaded |
| `skills/amazon-listing/SKILL.md` | Reusable procedure for building listing files |

## Fast facts

- Brand: **KNITE** (Brand Registered) · Product type: `WATER_PURIFICATION_UNIT`
- Marketplace ID: `A21TJRUUN4KGV` · Language tag: `en_IN`
- Product ID Type: **`GTIN Exempt`** (value left blank) — not blank/blank
- HSN: `84212120` · GST: 18% · Tax code: `A_GEN_STANDARD`
- Title limit: **200** chars in feed, but **≤75** required for Item Highlight to render
