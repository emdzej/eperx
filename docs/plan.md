# Why eperx is shaped this way

## What it is

A browser client for the ePER parts catalogue, reading a static tree with no
backend. It ships **without data**: bring a DVD.

ePER itself is a Java web application — Jetty, ImageMagick, a JDBC-to-ADO
bridge into Access, and a `gslgen.exe` template engine — served to a local
browser on Windows. That stack is 2014 vintage and the ADO bridge is the part
that ages worst: it is a Win32 DLL against a Jet provider Microsoft has been
retiring for a decade. The data underneath it is fine.

## Why the drawings need no conversion, and the catalogue does

The two halves of the disc are not alike, and the architecture follows from
that rather than from a preference.

**The drawings are already served.** `images/*.res` are ZIP archives whose
219,253 drawing entries are _stored_, not deflated. A stored ZIP entry is a
byte range containing the file itself. That is the shape of an HTTP `Range`
request, so a static host can serve the vendor's own `.res` files and a browser
can pull one PNG out of a 19 MB archive with one request. 4.7 GB of drawings
pass through untouched. This is the same property that lets dialogysx read
Dialogys' data in place, arrived at for a different reason.

**The catalogue is not.** `SP.DB` is an Access database. It has indexes — five
on `APPLICABILITY` alone — but they are Jet B-tree pages, and reading them from
a browser would mean implementing a second storage engine against a
third-party format for no gain over one that browsers already read. So
`eperx import` converts it to SQLite once, with indexes chosen for the queries
the client actually makes, and the browser reads that over `Range`.

Converting is a real cost and worth naming: it puts a step between the disc and
what the user sees, and a bug in that step is a bug in every answer. The
mitigations are that the conversion is a straight table-for-table copy with the
disc's own names, and that `mdbtools` gives an independent reading of the same
file to diff against.

## Sizing

Measured on edition 83, English only:

|                                         |                                 |
| --------------------------------------- | ------------------------------- |
| `catalogue.sqlite`, one language        | 536 MB                          |
| rows, one language                      | 5,253,068 of 8,534,325          |
| import time, catalogue                  | 43 s                            |
| import time, catalogue + image index    | 97 s                            |
| drawing shards                          | 5.07 GB, 228,226 entries        |
| image index                             | 210,481 rows                    |
| browser: open a shard, render a drawing | 4 requests, 118.9 kB of 18.8 MB |

Language selection is the main lever: the per-language description tables are
about 62% of all rows.

The image index exists because resolving a ZIP entry to its payload needs its
local header read. Doing that in the browser costs an extra round trip per
image; doing it once at import costs one row per entry.

## Phases

**1. Read the disc.** Done. `eperx disc`, `eperx tables`, `eperx import`,
`eperx image` work against a real DVD end to end — a `DRAWINGS` row resolves to
a 2150×1675 PNG out of the vendor's own shard.

**2. Browse it.** In progress. The browser client reads a shard over `Range`
and renders a drawing, which proves the transport end to end — 118.9 kB of an
18.8 MB archive. What it does not do yet is read `catalogue.sqlite`, so there
is no hierarchy, no callout list and no part search in the UI. That needs a
read-only SQLite VFS over `read(pos, len)`; everything below it already exists.

**3. Applicability.** Specify and verify the `PATTERN` grammar so parts can be
filtered to a specific vehicle. This is the critical path and the one part that
can be wrong in a way that matters — see
[`data-format.md` §5](data-format.md#5-the-pattern-grammar). Characterised:
`+` AND, `,` OR, `()` grouping, tokens are `VMK_TYPE || VMK_COD` concatenated.
Not settled: `!`/`@`/`?`, and tokenisation where type names collide (`CM` vs
`CMB` in catalogue `4Y`). **No parts-by-vehicle view ships before this has
known-answer tests.**

**4. VIN.** The F3 format in `SP.CH`, so a VIN resolves to a factory
specification instead of a generic model. openPER's MIT `KtdReader` documents
the layout.

## Ranked risks

1. **Applicability is wrong but plausible.** A pattern that parses and yields a
   confident, incorrect parts list. Nothing in a green test run catches it. The
   only defence is known-answer tests against real vehicles, which is why
   phase 3 gates on them rather than on the parser running.
2. **Tokenisation ambiguity is real, not just theoretical.** If some catalogue
   has a pattern that genuinely splits two ways, the grammar needs information
   that is not in `CARAT_DSC`. Unmeasured.
3. **The conversion silently drops something.** A table imported with the wrong
   type, a memo truncated, a language filter that discards more than intended.
   Row counts are reported per table and diffable against `mdbtools`.
4. **Edition drift.** Every claim here is against edition 83. Column names,
   `MAP_NAME` gaps and even table sets differ between releases — openPER
   targets 84 and already documents patches. The index list is checked against
   the real schema at import time so a rename fails loudly.

## Out of scope by decision

- **Pricing** — `SP.PL`, and the price-list plumbing in `navi.properties`.
  Same call dialogysx made. Formats get documented if they share machinery;
  no features get built.
- **Ordering and dealer systems** — `eplus_*` endpoints, `SP.RT`'s
  order-shaped tables, the DMS basket submission in `it.keytech.dms`.
- **Licensing** — `CodeVerifier.dll` and `WEB-INF/lib/11100298.LIC`. Not
  examined, not implemented.

## Licence, and what may be borrowed

eperx is **PolyForm Noncommercial 1.0.0**.

[openPER](https://github.com/CReynolds/openPER) is **MIT**, so its schema
knowledge and code may be used here with attribution. This is worth stating
because the sibling project dialogysx has the opposite constraint — its
counterpart ddtx is GPL and must be kept at arm's length — and applying that
rule here would leave good work on the table for no reason.

The catalogue data is Fiat's, is not ours, and is not redistributed. `data/`
and the reverse-engineering working directories are git-ignored.
