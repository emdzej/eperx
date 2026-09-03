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

|                                      |                            |
| ------------------------------------ | -------------------------- |
| `catalogue.sqlite`, one language     | 567.8 MB, `page_size` 4096 |
| rows, one language                   | 5,253,068 of 8,534,325     |
| indexes                              | 41                         |
| import time, catalogue               | 43 s                       |
| import time, catalogue + image index | 97 s                       |
| drawing shards                       | 5.07 GB, 228,226 entries   |
| image index                          | 210,481 rows               |

In the browser, against a real HTTP server, reading `catalogue.sqlite` over
`Range` — cumulative, so the last row is the whole session:

| After                                        | Requests | Bytes  |
| -------------------------------------------- | -------- | ------ |
| connect and list the marques                 | 17       | 97 kB  |
| walk to a drawing and its callouts           | 71       | 377 kB |
| search a part number and list its 200 usages | 92       | 597 kB |

Plus one ranged request for the drawing itself: 49.3 kB out of an 18.8 MB
shard. So the whole session costs **597 kB of a 567.8 MB database — 0.11%**.

Language selection is the main lever: the per-language description tables are
about 62% of all rows.

The image index exists because resolving a ZIP entry to its payload needs its
local header read. Doing that in the browser costs an extra round trip per
image; doing it once at import costs one row per entry.

## Two measurements that changed the code

**`LIKE 'prefix%'` cannot use an index.** SQLite's `case_sensitive_like`
defaults to off, which makes `LIKE` case-insensitive and rules out a BINARY
index; the planner reports `SCAN p` and reads all 1,415,102 rows of `PARTS`.
Over HTTP that measured **786 requests and 126 MB for one part-number
search**. Rewritten as `PRT_COD >= ? AND PRT_COD < ?` with the upper bound
computed in JS, it plans as `SEARCH p USING COVERING INDEX` and the same
search costs kilobytes. `prefixRange` in `@eperx/catalogue` computes the
bound, and the comment there records why incrementing the last character is
exact for this data.

**Where-used needs a covering index, not a narrow one.** A part can appear on
2,824 `TBDATA` rows, and with an index on `(PRT_COD)` alone each match costs a
row fetch — 672 requests and 3.0 MB for one lookup. Widening the index to
carry the nine columns the query returns drops that to **21 requests and
220 kB**. It has to _replace_ the narrow index rather than sit beside it: with
both present the planner picks the smaller one and fetches rows anyway.

## Page size: 4096, against the library's advice

`sqlite-wasm-http` recommends `page_size = 1024` and warns on every connect
that ours is 4096. Measured, over the same session as above:

| `page_size` | Requests | Bytes  | File     |
| ----------- | -------- | ------ | -------- |
| **4096**    | 92       | 597 kB | 567.8 MB |
| 1024        | 149      | 350 kB | 588.2 MB |

1 KB pages move 41% fewer bytes but need 62% more requests. The backend eperx
uses is the **synchronous** one, which issues its reads one at a time, so the
cost is roughly `requests × RTT + bytes / bandwidth` and the request term
dominates at any realistic latency: at 50 ms RTT, 4 KB pages come out about a
third faster despite transferring more. The library's advice most likely
assumes the shared-cache backend, which can overlap requests — and that one
needs the cross-origin isolation headers eperx deliberately does not require.

Revisit this if the transport ever parallelises. Until then the warning in the
console is expected and should not be "fixed".

## Phases

**1. Read the disc.** Done. `eperx disc`, `eperx tables`, `eperx import`,
`eperx image` work against a real DVD end to end — a `DRAWINGS` row resolves to
a 2150×1675 PNG out of the vendor's own shard.

**2. Browse it.** Done. The browser client walks
`marque → model → catalogue → group → subgroup → drawing`, renders the
diagram, lists its callouts with names and quantities, searches part numbers,
and shows every drawing a part appears on with a click through to each. SQLite
runs in a worker and reads the database over `Range`; the drawing comes
straight out of the vendor's own shard.

Not in the UI yet: cliches (`CLICHE` / `CPXDATA`), the graphical group
selector (`MAP_*`), supersessions (the `replacements` query exists but nothing
renders it), and the accessories catalogue.

**3. Applicability.** The grammar is specified, implemented and validated —
see [`data-format.md` §5](data-format.md#5-the-pattern-grammar). All 107,957
distinct patterns parse except 39 malformed ones (0.036%), and `DRAWINGS` and
`MVS` parse at 100%. Evaluation is Kleene three-valued, so "not known" is a
possible answer rather than a guess.

There is no external answer key, so it is validated by reachability instead:
`MVS` lists every sold version of a vehicle, so a drawing no version can see
is dead data. Across all 223 catalogues, **18 of 81,415 drawings are
unreachable (0.02%)**. `eperx applicability` reports it, and a rise is a
regression.

Still open, and all written down: `?` (3 rows), the precedence of `!` against
an implicit AND (26 patterns), and how several matching alternatives on one
callout are resolved — almost certainly `TBD_SEQ` order, since 84,897 of
84,902 multi-formula callouts number their rows distinctly, but that is
inferred rather than confirmed.

**Built:** a parts-by-vehicle view. Choosing a version — or a VIN — scores the
drawing list, the diagram and every callout as fits / does not fit / not
determined, with the pattern shown both as written and in words. Only a
definite non-fit is hidden; "not determined" is always shown, because
declining to answer must not look like an answer.

**4. VIN.** Done. `@eperx/ktd` reads the F3 format, and both routes work.

`SP.DB`'s `VIN` table maps a VIN's three-character type code to a model with no
new format work at all, but it only narrows to 3.4 catalogues on average — a
shortlist, not an answer.

The real lookup goes to the F3 files: `SP.CH` keyed on
`MODEL || chassis.padStart(8, "0")` gives the exact `MVS` for a chassis, and
`SP.RT` keyed on `MODEL || chassis.padStart(7, "0")` gives that individual
car's build record — `CODOPT` (options fitted) and `CARATT` (characteristics),
which are criteria codes. So a VIN yields a specification for _this car_,
which is stronger than the version-level one phase 3 has to close by
inference.

The index is a sorted fixed-width array, so it is binary-searched over ranged
reads: a lookup against the 420 MB `SP.CH` costs about fifteen 19-byte reads
plus one compressed block — roughly 20 kB — and runs unchanged in the browser.
Measured end to end, a CLI lookup against `SP.CH` + `SP.RT` takes **1.2 s**.

openPER's `KtdReader` and `Release84VinSearch` are MIT and documented both key
constructions; every field was then confirmed against all four F3 files.

**What it does not solve:** a disc is a snapshot. Edition 83 stops at chassis
`0J169775` for the Fiat 500, so a later car is simply absent — which the
lookup now reports as such, scoped to the chassis series, rather than as a
flat "not found".

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
