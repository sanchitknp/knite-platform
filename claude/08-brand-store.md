# Brand Store

`subEntityId=<store subentity id>` · Brand display name KNITE · **not yet published**

## Current page structure

Header (3000×600 banner) · 3 Tiles (brand statement, high TDS, warranty) ·
3 Tiles (shoppable images) · 8 Tiles (8 product tiles with live prices) ·
Image with text (hero) · Product Grid (all 9 products)

## Blocking issues

1. **Three "Shoppable image: Add 1 or more interaction points" errors.** Those tiles are
   single products on plain backgrounds — nothing meaningful to hotspot. Recommended fix
   is deleting that 3-tile section.
2. **Hero sits at the bottom.** New sections append; "Move section" moves between *pages*,
   not within one. Reordering needs drag-and-drop on the ⋮⋮ handle.

## Hard-won notes

- The builder canvas is an **iframe**; tiles are inside it
- The tile-type chooser renders **scrolled above the viewport** — scroll it into view
  before clicking
- Section menus open reliably via **keyboard** (focus the `aria-haspopup="menu"` button,
  press Return), not by clicking
- Two menus can be open at once; **verify which section owns the open menu** before
  clicking Delete
- Logo must be ≥400×400. The KNITE wordmark is 660×135 — pad it, do not stretch
- Product Grid returned "No items available" while the Buy Box was suppressed. It
  populated once Featured Offer returned.

## Competitor reference

**Native by Urban Company** — multi-page nav, every title repeats the same three claims
(No Service for 2 Years, India's Only 2-Year Unconditional Warranty, Free Pre-filter),
closing sections are trust statements not specs. Review counts 671–7,316.

**KENT** — multi-page nav, positioning is service network and installed base. 15,439
reviews on one listing. Their newer listings have shifted to "2 Yrs Comprehensive
Warranty | No Service", i.e. copying Native.

**Where KNITE wins:** Edge is 4-year unconditional at ₹13,999 against Native's 2-year at
₹17,499 — longer warranty, lower price. That is the axis the category competes on.

**Where KNITE cannot compete:** review base, and KENT's service network. Do not build a
store that invites those comparisons.
