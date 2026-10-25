# Known Amazon errors and their fixes

Every error code hit during catalogue work, with the actual cause.

| Code | Message | Cause and fix |
|---|---|---|
| **90220** | Listing Action value invalid | `Add Product` is a Listing Loader value. Category template takes `Create or Replace (Full Update)`, `Edit (Partial Update)`, `Delete`. |
| **90225** | Item Name longer than allowed maximum (200) | Feed limit is 200, not 75. Trim to ≤200. |
| **100476** | Provide an Item Name 75 characters or less to use Item Highlights | Either shorten the title to ≤75, or clear the Item Highlight. A blank cell in a partial update will **not** clear it — edit in Seller Central. |
| **90041** | Missing required fields | Often downstream of an unrecognised Listing Action — fix that first and re-check. |
| **99022** | Quantity requires fulfillment_channel_code | Any row touching the offer group must carry `fulfillment_channel_code` alongside `quantity`. |
| **19038** | Selling price higher than maximum price setting | Raise `maximum_seller_allowed_price` above the new price. |
| **18155** | Selling price below minimum price threshold | **B2B price is a separate audience.** Raising retail without raising `purchasable_offer[...][audience=B2B]` leaves B2B below the new floor. |
| **18701 / 18639** | Potential high / low pricing error | Cannot be fixed by file. Confirm in **Pricing → Pricing Health**. |
| **20000** | Image could not be downloaded (timeout) | Google Drive `/uc?export=download` serves an interstitial, not bytes. Use `lh3.googleusercontent.com/d/{id}=w2000`, or host on knite.in. |
| **5461** | Product already in catalogue, needs new ASIN | Seller Support case required. Also a signal the product is not distinct enough. |

## Ads bulksheet errors

| Error | Fix |
|---|---|
| `campaign negative phrase` invalid Match Type | Use the API enum **`negativePhrase`**, not the UI label. |
| Start date cannot be in the past | Leave Start Date blank; Amazon defaults to upload date. |
| "requires an actual Campaign ID rather than a temporary ID" | The `A0...` IDs in console URLs are **UI entity IDs**. Bulksheet updates need the **numeric** IDs from Bulk Operations → Download. |

## Compliance fields FBA requires that FBM does not

Creating FBA offers failed until these were added:

- `batteries_required` = `No`
- `batteries_included` = `No`
- `supplier_declared_dg_hz_regulation` = `Not Applicable`

## Other things that bite

- **FBA quantity** must be left blank — it comes from received inventory.
- **Handling time** must be left off FBA rows; sending it reverts the SKU to merchant-fulfilled.
- **Preference Profile prefill** seeds values that may be wrong for the model. Observed:
  Capacity 10L on a 12L unit, HSN `84212110` instead of `84212120`, Purification Method
  "ABS Plastic" (that is the body material), Included Components "Extra Filter",
  Unit Count filled but Unit Count Type blank. **Check every prefilled cell.**
