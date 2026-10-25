# Flat-file playbook

How to build an Amazon listing upload that passes on the first attempt.

## The template is the source of truth

Never hand-write attribute names. Always read them from row 5 of the `Template` sheet of
a freshly downloaded template or Category Listings Report.

```python
col = {}
for c in range(1, ws.max_column+1):
    a = ws.cell(5, c).value
    if a: col.setdefault(str(a).strip(), c)
```

Row 4 = human labels · Row 5 = attribute names · Row 6 = Amazon's `ABC123` example
(clear it) · Row 7 = may be a "do not delete" notice · Data starts at row 7 or 8.

**Check which row the data goes in.** It differs between templates. The settings string
in row 1 contains `dataRow=`.

## Fail loudly on unknown attributes

The single most costly bug in this project came from a helper that silently skipped
attributes it did not recognise:

```python
def S(attr, val):
    assert attr in col, 'MISSING COLUMN: ' + attr   # never skip silently
    ws.cell(R, col[attr]).value = val
```

Without the assert, a mis-typed attribute name produces a file that looks correct, passes
your own checks, and does the wrong thing on Amazon. See `04-known-errors.md`.

## Array attributes replace, they do not patch

`bullet_point`, `generic_keyword`, `included_components`, `purification_method` are
**arrays**. Supplying `#1` only replaces the entire array with one element.

> Writing one changed bullet wiped bullets 2–5 on all 22 SKUs.

**Always write every element of an array attribute, even unchanged ones.**

Single-value fields behave differently: a blank cell in a partial update means
"leave alone", which is why keywords can be preserved by simply not writing them.

## Product identifiers

For a **new** product under GTIN exemption:

| Field | Value |
|---|---|
| `amzn1.volt.ca.product_id_type` | `GTIN Exempt` |
| `amzn1.volt.ca.product_id_value` | *(blank)* |

Leaving **both** blank fails validation. Valid types: `EAN`, `GTIN`, `UPC`, `ASIN`,
`GTIN Exempt`.

Putting an existing ASIN in `product_id_value` with `Create or Replace` **overwrites that
listing**. This happened once and required a full revert.

## Listing actions

Category Listings Report template accepts only:
`Create or Replace (Full Update)` · `Edit (Partial Update)` · `Delete`

`Add Product` is a Listing Loader value and will be rejected.

## Field limits

| Field | Limit |
|---|---|
| Item Name | 200 chars (but see below) |
| Item Highlight | 125 chars |
| Bullet Point | 500 chars each |
| Generic Keyword | ~195 bytes each |
| Product Description | 2,000 chars |

**Item Highlight only renders when Item Name is ≤75 characters.** Over 75 and the
highlight is stored but invisible, and the feed returns error 100476. Title + highlight
render as one line on the page (~200 chars), so ≤75 + highlight beats a 200-char title.

## Keyword rules

- No punctuation
- No brand names — not competitors', not your own (KNITE is already indexed from the title)
- Do not add misspellings; Amazon normalises predictable typos. Genuine dual-use variants
  (liter/litre, bore well/borewell) are worth including.
- Vernacular is high-value and low-competition: `pani`, `paani`, `jal`, `shudh`,
  `peene ka pani`, `tamba`, `kshariya jal`, plus romanised regional — `jol` (Bengali),
  `thanni` (Tamil), `neeru` (Telugu/Kannada), `vellam` (Malayalam)

## Verify before you ship the file

```python
# re-open the SAVED file and check the ACTUAL column names
for a in [x for x in col if 'product_id' in x]:
    print(a, '=', t.cell(R, col[a]).value)
```

A check that reads the same variable the writer used proves nothing. Read it back from
disk, by the real attribute name.
