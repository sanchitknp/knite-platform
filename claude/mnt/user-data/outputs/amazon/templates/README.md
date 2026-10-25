# Templates

Amazon flat-file templates, kept here so they need not be re-downloaded each time.

| File | Use |
|---|---|
| `WATER_PURIFICATION_UNIT.xlsm` | Purifiers. 5 keyword slots, 5 bullets. **Correct category.** |
| `POTABLE_WATER_FILTER.xlsm` | Replacement filters, membranes, cartridges. Only **1** keyword slot and 1 Included Components slot — do not use for whole purifiers. |
| `Category_Listings_Report_reference.xlsm` | Snapshot of the live catalogue, 24 Oct 2026. Useful for restoring original content. |

Templates carry an embedded `settings=` string in row 1 that identifies the feed. Always
upload the `.xlsm`, not a CSV built from it.

Browse nodes in `POTABLE_WATER_FILTER` are all replacement-filter categories — listing a
purifier there would categorise it as a cartridge.
