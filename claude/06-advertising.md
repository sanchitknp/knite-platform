# Advertising

## What the live data showed

Ads served, CTR was poor, top-of-search share sat at zero despite a +50% placement
adjustment, and conversion was nil. Budget was never the constraint — most of the
available daily spend went unused. Exact figures are in the confidential reference.

## Structure that works

Five campaigns, one per model, each with its own ad group, budget and SKUs.

- **Shared head terms** (broad, ~₹10) in every campaign so all models compete for the
  1.16M-search head
- **Model-specific exact terms** (~₹15) per lane
- **Cross-lane negatives** only on the other lanes' *signature* terms — head terms stay
  open to all
- Junk negatives: filter cartridge, spun filter, membrane only, candle, repair,
  service near me, spare parts, amc plan, second hand, refurbished, **wall clock**,
  **prime drink**, water bottle

## Bulksheet notes

- Match Type for campaign negatives is **`negativePhrase`**, not the UI label
- Leave Start Date blank
- Updates need **numeric** Campaign IDs from Bulk Operations → Download, not the `A0...`
  entity IDs in console URLs
- Download must include **"Paused campaigns"** or paused campaigns are missing from the
  export

## What not to run

- **Brand defence on `knite ro`** — that traffic is internal
- **Competitor conquest** — ₹85–145 per click against listings with no reviews
- **Generic heads at scale** — against brands with 17,000 reviews

## Standing advice

Reviews gate everything. Ads buy visibility; they cannot buy conversion on a listing with
zero social proof. Pull the Search Term Report at day 14 and set bids from measurement.
