# Images

## Drive structure

`Amazon_UPDATED / All_models_final_images_complete / <Model> / <Colour> /`
with `Listing`, `A+ web` and `A+ mobile` subfolders.

Models: Flux (Black, White) · Core · Prime (Black, White) · Shield (Copper, Black,
Silver) · Edge (Titanium Gold, Smokey Grey)

`Amazon_UPDATED / Archive` holds retired images, prefixed with their source
(`PrimeBlack-Listing-06-family-protection.png`).

## Gallery limit

**9 images** — one main plus eight others. A folder with 10 has one too many.

## Hosting for flat-file upload

| URL form | Works? |
|---|---|
| `drive.google.com/uc?export=download&id=…` | **No** — serves an interstitial, error 20000 |
| `drive.google.com/thumbnail?id=…` | No — CORS blocked |
| `lh3.googleusercontent.com/d/{id}=w2000` | **Yes**, if the file is publicly shared |
| `knite.in/products/{slug}.jpg` | **Yes** — reliable, no throttling |

### Rate limiting caveat

`lh3.googleusercontent.com` returns **HTTP 429** with 2 KB of HTML after a few rapid
requests. Amazon fires ~9 requests per SKU in quick succession. A 429 does not look like
an error to the crawler, so you get a silent partial result.

**Prefer knite.in hosting for bulk image uploads.** Nine product shots already live at
`knite.in/products/{slug}.jpg`, 1080×1080, CORS-open:

```
knite-core · knite-flux · knite-flux-white · knite-prime-black · knite-prime-white
knite-shield-copper · knite-shield-silver · knite-edge-black · knite-edge-silver
```

## Compositing for Amazon's minimums

Store shoppable tiles need 1920×1920; headers need 3000×600. Source shots are 1080×1080.
Composite onto a compliant canvas rather than upscaling — warm off-white `#FAF7F5` ground
with a faint copper radial `rgba(179,103,73,0.06)` matches the brand.

**Keep overlay text clear of the product.** A header built with text at x=110 and products
starting at x=234 overlapped badly.

## Known image/content conflicts

- Older Flux images read "7-Stage" — now correct, Flux is 7-stage
- `07-warranty-4year-*.png` exists in Edge folders — correct for Edge only
- `02/04-10stage-ro-uv-purification.png` — matches Prime/Shield/Edge at 10 stages
