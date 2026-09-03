# The ePER data formats

Reference for the formats on an ePER DVD. Written against **edition 83**
(`version.txt` `8.30.0`, data release `04147`, dated 2014-04-03).

Everything here was established by reading the disc. Where a claim rests on a
single observation, it says so. Where something is undecoded, it is listed in
[§8](#8-what-is-not-decoded) rather than guessed at.

## 1. What is on the disc

An ePER DVD is an InstallShield 12 package (`setup.exe`, `data1.hdr`,
`data1.cab`, `data2.cab`) plus a `data/` directory that is **not** in the
installer — it is copied as-is and read in place by the application.

```
data/
  runparam.ini                 what the application opens, and the version
  SP.DB.04147.FCTLR   1.33 GB  spare parts catalogue      — Jet 4 (§2)
  AM.DB.04147.FCTLR   279 MB   accessories / Mopar        — Jet 4 (§2)
  SP.CH.04147.FCTLR   420 MB   chassis and VIN            — F3    (§4)
  SP.RT.04147.FCTLR   286 MB   ?                          — F3    (§4)
  SP.TR.04147.FCTLR   329 MB   chassis → part             — F3    (§4)
  SP.RTCHRY.04147...  804 KB   Chrysler VIN               — F3    (§4)
  SP.PL.04147.FCTLR   133 MB   price lists                — §8
  images/*.res        4.7 GB   drawings, 261 ZIP shards   — §3
  SP.{IM,MP,MS,NA,TS}.04147.FCTLR/   placeholder directories, `hold.me` only
```

The `.FCTLR` suffix carries no format meaning — the same suffix covers three
unrelated formats and two empty directories. **Nothing may key off it**, and
nothing may hardcode `04147`: the release number is part of every filename and
changes per edition. `runparam.ini` names each file the application opens and
is the disc's own statement of what it ships.

### The application

ePER is a **Java web application** — Jetty, `it.keytech.*`, 1,094 classes in
`WEB-INF/lib/classes.jar`, served to a local browser. `unshield x data1.cab`
extracts it. Package names are not obfuscated.

It reaches the Access databases through **Izmado** (`izmado.jar` +
`izmjniado.dll`), a JDBC-to-ADO bridge — so the connection string in
`WEB-INF/conf/appdb.properties` is a Jet OLEDB provider string, and the
databases carry no password. It renders drawings with **ImageMagick 6.5.9** via
`jmagick.jar`, and builds pages by shelling out to `bin/gslgen.exe` over
`WEB-INF/scriptGsl/*.gsl` templates.

`WEB-INF/conf/navi.properties` is the most useful single file on the disc for
orientation: it names the image servlet's layout (`ImageMapServlet.ImagePath`,
`DivideByFirstFolder=true`), the chassis and price-list sources, and the
hardcoded lab endpoints.

## 2. SP.DB and AM.DB — Access (Jet 4)

Both are plain **Jet 4** databases: page 0 opens `00 01 00 00` then
`Standard Jet DB`, with `01 00 00 00` at 0x14 marking version 4. Page size 4096. **No database password**, no encryption.

This is a solved, third-party format. eperx does not implement it —
[`mdb-reader`](https://www.npmjs.com/package/mdb-reader) (MIT) reads both
files, and `mdbtools` serves as an independent second opinion. Reimplementing
Jet would be undifferentiated work on a format that is not ePER's.

Measured on edition 83:

|                   | `SP.DB`                                        | `AM.DB`                                           |
| ----------------- | ---------------------------------------------- | ------------------------------------------------- |
| tables            | 55                                             | 22                                                |
| rows              | 8,534,325                                      | 2,466,432                                         |
| column types used | TEXT, INT, LONG, MEMO, DATETIME, FLOAT, DOUBLE | TEXT, INT, LONG, DATETIME, FLOAT, DOUBLE, NUMERIC |

`NUMERIC` appears on exactly one column (`MM_Products.IntFiatCode`), so it has
a single witness. `mdb-reader` hands it back as a string, which is why the
SQLite column takes NUMERIC affinity rather than REAL — REAL would round it.

### The catalogue hierarchy

`Make → model group → catalogue → group → subgroup → subsubgroup → table →
drawing → part`, with cliches hanging off individual parts.

| Level         | Table                | Key                          | Rows             |
| ------------- | -------------------- | ---------------------------- | ---------------- |
| Make          | `MAKES`              | `MK_COD`                     | 6                |
| Model group   | `COMM_MODGRP`        | `MK2_COD, CMG_COD`           | 79               |
| Catalogue     | `CATALOGUES`         | `CAT_COD`                    | 223              |
| Group         | `GROUPS`             | `CAT_COD, GRP_COD`           | 5,301            |
| Subgroup      | `SUBGROUPS_BY_CAT`   | `CAT_COD, GRP_COD, SGRP_COD` | 26,788           |
| Drawing       | `DRAWINGS`           | see below                    | 114,259          |
| Callout       | `TBDATA`             | see below                    | 1,611,215        |
| Part          | `PARTS`              | `PRT_COD`                    | 1,415,102        |
| Cliche        | `CLICHE` / `CPXDATA` | `CLH_COD`                    | 19,709 / 126,528 |
| Version       | `MVS`                | `CAT_COD, MOD_COD, MVS_*`    | 36,332           |
| Applicability | `APPLICABILITY`      | `PRT_COD`                    | 1,219,221        |

`MAKES` has six rows: `F` FIAT, `L` LANCIA, `R` ALFAROMEO, `T` LCV,
`C` ABARTH, `E` CHRYSLER. `CATALOGUES.MK_COD` and `MK2_COD` differ — the
second splits FIAT into commercial and non-commercial vehicles.

`GROUPS.GRP_COD` is **TEXT** while `GROUPS_DSC.GRP_COD` is **INTEGER**. Joining
them needs a cast, and SQLite will silently match nothing without one.

### Drawing → parts joins on TABLE_COD, not DRW_NUM

This is the trap in the schema.

`DRAWINGS` and `TBDATA` share the columns `CAT_COD, GRP_COD, SGRP_COD,
SGS_COD, DRW_NUM, TABLE_COD, VARIANTE, REVISIONE`, which invites a join on the
path including `DRW_NUM`. That join returns **nothing**: `DRAWINGS.DRW_NUM`
numbers a table's variants for display (1, 2, …), and `TBDATA.DRW_NUM` is `0`
on the rows belonging to them.

The relation is `(CAT_COD, TABLE_COD, VARIANTE, REVISIONE)`. Worked example,
Nuova Panda (`CAT_COD` `33`), group 101, subgroup 1, subsubgroup 10:

```
DRAWINGS   DRW_NUM=1  VARIANTE=1  REVISIONE=0  TABLE_COD='10101-010'  PATTERN='CC1.2+(CMBBZ,CMBBG)'
DRAWINGS   DRW_NUM=2  VARIANTE=2  REVISIONE=0  TABLE_COD='10101-010'  PATTERN='CC1.3+CMBDS'
TBDATA     DRW_NUM=0  VARIANTE=1  REVISIONE=0  TABLE_COD='10101-010'  → 6 callouts
TBDATA     DRW_NUM=0  VARIANTE=2  REVISIONE=0  TABLE_COD='10101-010'  → 8 callouts
```

Within a drawing, `TBD_RIF` is the callout number printed on the image and
`TBD_SEQ` distinguishes several part numbers under one callout.

### Descriptions are per language

Nothing user-visible is stored on the row that uses it. Every label is a join
to a description table keyed by `LNG_COD`, and `LANG` lists 20 languages
(`0` Italian, `3` English, `4` German, `N` Russian, …).

`TABLES_DSC` (992,020), `MODIF_DSC` (602,940), `DESC_AGG_DSC` (551,620),
`VMK_DSC` (502,440), `RPLNT_GRP` (222,180), `COLOURS_DSC` (226,800) and
`NOTES_DSC` (161,020) are the large ones. They are ~62% of all rows, which is
why selecting languages at import time is the main size lever — English alone
drops the catalogue from 8.53M rows to 5.25M.

## 3. images/*.res — the drawings

261 ZIP archives. `DRAWINGS.IMG_PATH` addresses an image as
`"BA/BA061CCF4B1E35C4D1CD4DF5A6B37B1B.png"`: the part before the slash names
the shard (`BA.res`), the rest is the entry. Every full image has a thumbnail
beside it under the same name with `.th.png`. ePER's own configuration says as
much — `ImageMapServlet.ImagePath=/../../data/images/` with
`DivideByFirstFolder=true`.

**All 219,253 entries in the 256 hex-named shards are stored, not deflated**
(method 0), measured across every shard. This is the property the drawing path
rests on: the bytes of a `.png` entry _are_ the PNG, so one HTTP `Range`
request against the vendor's own file yields a usable image — no conversion,
no transcoding, no repacking of 4.7 GB.

The five `L_*` shards are auxiliary and behave differently:

| Shard             | Entries | Contents                               |
| ----------------- | ------- | -------------------------------------- |
| `L_ALLMAKES`      | 5,378   | model photographs, all deflated JPEG   |
| `L_ALLMAKESTHUMB` | —       | their thumbnails, stored               |
| `L_EPERFIG`       | 2,359   | _figurini_ — trim illustrations, mixed |
| `L_EPERPROMO`     | 16      | promotional art, mixed                 |
| `L_EPERTESSUTI`   | 4,614   | fabric swatches, mixed                 |

8,973 entries across those four are deflated. They also contain vendor
leftovers that shipped by accident: 68 `Thumbs.db`, 11 `.tif`, one `.bmp` and
one `.pptx`. So a reader records each entry's method rather than assuming it —
a drawing never needs inflating, a fabric swatch might, and a reader that
assumes wrongly produces a corrupt image rather than an error.

Resolving an entry to its payload requires reading its **local** header: the
local extra field may differ in length from the central directory's, so the
data offset cannot be computed from the central directory alone.

## 4. SP.CH, SP.TR, SP.RT — the F3 format

A custom blocked, indexed store. Not yet implemented in eperx.

The header opens with the ASCII magic `F3`, then table and column names in
fixed-width ASCII fields, then bzip2-compressed data blocks (`BZh91AY&SY`).
`SP.CH` declares tables `CHASSIS`, `MODEL`, `CHASSY`, `VIN`, `MVS`,
`ORGANIZATION`, `MOTOR`, `DATE`, `INT_*`; `SP.TR` declares `TA` with
`MODELLO`, `TELAIO`, `MATRICOLA`, `PART`; `SP.RTCHRY` declares `VINCHRYSLER`
with `VIN`, `BUILDDATE`, `PATTERN`.

openPER's `VinSearcher/KtdReader` reads this format and is **MIT**, so its
layout knowledge can be used here with attribution — see
[§7](#7-prior-work). Its structure names (`DbTableHeader`, `IndexBlock`,
`BlockSize`, `DbDataType`) map onto the header seen above, and it checks the
same `F3` magic.

`navi.properties` sets `CHASSIS_QUERY_SOURCE=FILE`, confirming the application
reads chassis data from these files rather than from Access.

## 5. The PATTERN grammar

**This decides which parts fit which vehicle. It is characterised but not
verified.** Treat any applicability answer as unverified until §5 has
known-answer tests.

Patterns appear on `DRAWINGS.PATTERN` (81,415 of 114,259 drawings carry one),
`MVS.PATTERN`, `MDF_ACT.PATTERN` and `TBDATA.TBD_VAL_FORMULA`.

A pattern is a boolean expression over criteria:

- `+` — AND
- `,` — OR
- `( )` — grouping
- `!` — present in the alphabet, presumably negation, **not yet confirmed**

`CC1.2+(CMBBZ,CMBBG)` reads _displacement 1.2 AND (fuel petrol OR fuel
LPG)_. Most patterns are flat disjunctive normal form: `,`-separated
conjunctions, up to 250 characters.

The full non-alphanumeric alphabet across all four columns, measured:
`! , ( ) + . / _ @ ?` plus space, CR and LF. Patterns can span lines. `@` and
`?` are unexplained.

### Criteria are a type concatenated with a code

A token is `VMK_TYPE || VMK_COD` with **no separator**. `CARAT_DSC` gives the
types for a catalogue and `VMK_DSC` gives the codes. For `CAT_COD` `33`:

```
CARAT_DSC   CMB → 'FUEL'                    VMK_DSC   CMB BZ → 'PETROL'
            CC  → 'DISPLACEMENT (COMMER.)'            CMB BG → 'GASOLINE / LPG'
            TC  → 'BODYWORK TYPE'                     CMB DS → 'DIESEL'
            A/T → '(ASPIRATED/TURBO)'                 CC  1.2 → '8V.LE 69HP'
            ...  9 types in total                     CC  1.3 → 'JTD'
```

So `CMBBZ` = `CMB` + `BZ`, and `CC1.2` = `CC` + `1.2`.

### Tokenisation is ambiguous, and that is the open risk

Type names are not prefix-free. Measured collisions within a single catalogue:

| Catalogue                    | Types                |
| ---------------------------- | -------------------- |
| `4Y`                         | `CM` and `CMB`       |
| `12`, `13`                   | `G` and `GSS`        |
| `24`, `25`, `32`, `63`, `75` | `C_LIN` and `COLINT` |

So `CMBZ` in catalogue `4Y` could split as `CM`+`BZ` or `CMB`+`Z`, and longest
-prefix matching on the type alphabet alone is not sound. Tokenisation has to
be resolved against the actual `(VMK_TYPE, VMK_COD)` pairs that exist for that
catalogue — and whether _that_ is unambiguous everywhere is unmeasured.

Type names also contain `/` and `_` (`A/T`, `C_LIN`), which is why those
characters appear in the alphabet above and must not be read as operators.

## 6. Established by

| Claim                     | How                                                                               |
| ------------------------- | --------------------------------------------------------------------------------- |
| Jet 4, no password        | page 0 magic and version byte; both files open in `mdb-reader` and `mdbtools`     |
| Row and table counts      | counted, not estimated, on edition 83                                             |
| Column types in use       | enumerated over all 77 tables of both databases                                   |
| Drawing shards are stored | `compress_type` tallied over all 261 shards, 228,226 entries                      |
| `IMG_PATH` layout         | `DRAWINGS` rows resolved to entries and extracted; PNGs decode at 2150×1675       |
| Drawing↔parts key         | the `DRW_NUM` join returned zero rows; `TABLE_COD, VARIANTE` returns the callouts |
| PATTERN alphabet          | distinct characters over all four PATTERN columns                                 |
| PATTERN tokens            | joined against `CARAT_DSC` and `VMK_DSC` for `CAT_COD` `33`                       |
| Tokenisation ambiguity    | self-join of `CARAT_DSC` for prefix pairs within a catalogue                      |
| F3 magic and tables       | header hexdump of four files                                                      |

## 7. Prior work

[**openPER**](https://github.com/CReynolds/openPER) by Christopher Reynolds —
an ASP.NET reimplementation against release 84, **MIT licensed**. It converts
the Access data to SQLite and includes a working F3/KTD reader.

Because openPER is MIT and eperx is PolyForm Noncommercial, eperx **may** use
its knowledge and code with attribution. That is the opposite of the
dialogysx/ddtx situation, where a GPL sibling has to be kept at arm's length —
worth stating plainly so nobody applies the wrong rule here.

Its `Release84SchemaNotes.md` records that 13 catalogues have a missing
`MAP_NAME` and patches them by hand, leaving 10 without a map. Not yet checked
against edition 83.

## 8. What is not decoded

Honest list, so nobody reports these as discoveries.

- **`SP.PL` — price lists.** Format unexamined. Out of scope by decision
  (see [`plan.md`](plan.md)), so it is described, not built.
- **`SP.CH` / `SP.TR` / `SP.RT` bodies.** The F3 header parses by eye; the
  block index and row layout are not implemented. `SP.RT`'s purpose is
  unknown — its tables (`RTM`, `MOD_TEL`, `CIS`, `ORDINE`) suggest ordering.
- **`!`, `@` and `?` in patterns.** In the alphabet, meaning unconfirmed.
- **Whether pattern tokenisation is ever genuinely ambiguous**, given the
  prefix collisions in §5.
- **`HOTSPOTS`.** A memo on `DRAWINGS`, `TBDATA`, `KIT` and `CPXDATA`, null on
  every row inspected so far. It should be what makes callouts clickable —
  openPER lists "find image maps for drawings" as an open task too.
- **`MAP_GRP` / `MAP_SGRP` / `MAP_VET` / `MAP_INFO`.** Coordinates for the
  graphical group selector. Columns are self-describing; unused so far.
- **`CPXDATA.CLH_COD` is INTEGER while `CLICHE.CLH_COD` is TEXT(40).** Same
  mismatch shape as `GROUPS.GRP_COD`; not yet investigated.
- **`images/` entries with no extension** (657 of them) and the `.db`/`.pptx`
  leftovers. Assumed to be vendor accidents; not verified.
- **`SUBSYSTEM`, `ACTIVATIONS`, `TRANCHE`, `CODES_REC`, `PROMO_*`.** Read and
  imported, semantics not worked out.
