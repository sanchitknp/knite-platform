---
name: amazon-listing
description: Build Amazon.in flat-file uploads for the KNITE catalogue — new listings, partial updates, images, FBA offers. Use when asked to create or change an Amazon listing, fix a processing-report error, or add SKUs. Covers WATER_PURIFICATION_UNIT and POTABLE_WATER_FILTER templates.
---

# Building a KNITE Amazon listing file

## Before writing anything

1. Read `docs/01-catalogue.md` for the SKU/ASIN map and `docs/02-product-specs.md` for
   specs. Do not invent a spec.
2. Open the newest Category Listings Report or a fresh template. **Read attribute names
   from row 5** — never hand-write them.
3. Identify the data row. It varies: row 7 in some templates, row 8 where a Preference
   Profile notice occupies row 7. Row 6 is Amazon's `ABC123` example — clear it.

## Rules that are not negotiable

**Fail loudly.** A setter that silently skips unknown attributes will produce a file that
looks right and does the wrong thing:

```python
def S(attr, val):
    assert attr in col, 'MISSING COLUMN: ' + attr
    ws.cell(R, col[attr]).value = val
```

**Array attributes replace the whole array.** `bullet_point`, `generic_keyword`,
`included_components`, `purification_method`. Write every element or lose the rest.

**Product identifiers for a new listing:**
`amzn1.volt.ca.product_id_type` = `GTIN Exempt`, value blank. Never both blank. Never an
existing ASIN with `Create or Replace` — that overwrites the live listing.

**Verify by reading the saved file back**, using the real attribute names.

## Limits

Title 200 (but ≤75 to keep Item Highlight) · Highlight 125 · Bullets 500 each ·
Keywords ~195 bytes · Description 2,000.

## Output

One row per SKU, nothing else populated. Delete unused rows so the sheet ends at the last
data row. Save both `.xlsm` (upload this) and `.csv` (for review).

## After upload

Read the processing report. Match codes against `docs/04-known-errors.md`. Most errors
are one root cause with collateral — fix the cause, not each symptom.
