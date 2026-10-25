# FBA and logistics

## Setting up FBA offers

FBA is already enabled on the account. Create **parallel FBA SKUs** rather than
converting FBM ones — converting zeroes sellable stock until units are received, taking
the listing dark for 2–4 weeks.

Flat file: `fulfillment_channel_code` = `AMAZON_IN`, quantity blank, no handling time.

A template downloaded before FBA was enabled lists only
`Fulfillment by Merchant (Default)` as a valid value. Download a fresh one.

## Labelling

Amazon **cannot** provide prep or labelling for KNITE products — there is no scannable
GTIN on the packaging, because the catalogue runs on GTIN exemption. Both prep owner and
labelling owner must be **Seller**.

FNSKUs are **SKU-specific**, not model-specific. Codes are visually similar
(`<FNSKU>` Edge Titanium Gold vs `<FNSKU>` Shield Silver). Label and seal one SKU
completely before opening the next.

## Shipment reference (first shipment, Aug 2026)

- Shipment ID `<shipment id>` → FC **DEX3**, the assigned fulfilment centre
- 97 units across 8 SKUs, 97 boxes, 970 kg, declared <declared value>
- e-Way Bill `<e-way bill no>` · Challan <no> / <date> · Transporter the appointed transporter · Vehicle <vehicle no>

Amazon splits a plan across multiple shipments. Each destination needs **its own challan
and e-way bill**.

## Delivery challan

Stock transfer to an FBA fulfilment centre is **not a supply** — same GSTIN both ends, so
**GST is NIL**. The e-way bill confirms this: CGST/SGST/IGST all 0.00.

An e-way bill is mandatory above ₹50,000. Note validity — the first one was valid for a
single day over 26 km.

## Freight

Amazon Transportation Services quoted **₹119.99** for a 97-unit shipment. Third-party
carriers billing ~1,198 kg volumetric at ₹4–5/kg land near ₹5,000–6,000. Use ATS unless
it cannot collect from the pincode.

Quote couriers on **volumetric**, not actual — ~6.2 CBM for 80 boxes.
