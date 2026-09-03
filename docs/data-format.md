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

#### `MK_COD` and `MK2_COD` are not the same thing

`MAKES` has six rows: `F` FIAT, `L` LANCIA, `R` ALFAROMEO, `T` LCV,
`C` ABARTH, `E` CHRYSLER. `CATALOGUES` carries **two** make columns, and the
distinction matters:

- **`MK2_COD` is the marque.** It is what every level below keys off, and it is
  what joins to `MAKES.MK_COD`.
- **`MK_COD` is the parent brand** the marque is billed under.

Measured on edition 83:

| `MK_COD` | `MK2_COD` | `MAKES.MK_DSC` | Catalogues |
| -------- | --------- | -------------- | ---------- |
| `F`      | `F`       | FIAT           | 104        |
| `R`      | `R`       | ALFAROMEO      | 48         |
| `L`      | `L`       | LANCIA         | 41         |
| `F`      | `T`       | LCV            | 25         |
| `F`      | `C`       | ABARTH         | 5          |

So LCV (Fiat Professional) and ABARTH are their own marques but are billed as
FIAT. Joining `MAKES` on `MK_COD` — the obvious pairing of same-named
columns — labels both of them "FIAT" and yields three identical rows in a make
list. Join on `MK2_COD`.

`E` CHRYSLER appears in `MAKES` with no catalogues on this disc; only the
`SP.RTCHRY` VIN file mentions it. Deriving the make list from `CATALOGUES`
rather than from `MAKES` keeps it out.

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
`TBD_SEQ` distinguishes several part numbers under one callout. Verified
against the rendered PNG: drawing `33/101/1/10` variant 1 has callouts 1–4,
and the image carries exactly those four numbers.

A callout's display name is assembled from two tables, not one:
`CODES_DSC.CDS_DSC` via `TBDATA.CDS_COD` gives the name (`PLUG`, `DOWEL`,
`SCREW`), and `DESC_AGG_DSC.DSC` via `TBDATA.TBD_AGG_DSC` gives a qualifier
(`DIAM 14`). The qualifier is null on most rows, so a reader that uses only
`TBD_AGG_DSC` shows a mostly nameless parts list.

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

ePER's own format, and the only one on the disc that is neither Access nor
ZIP: a blocked, sorted, bzip2-compressed store with a sparse index. It holds
everything per-vehicle — 41,422,723 chassis records, 10,486,480 build records
and 120,134,472 fitment rows. **Implemented** in `@eperx/ktd`.

The header opens with the ASCII magic `F3`, then table and column names in
fixed-width ASCII fields, then bzip2-compressed data blocks (`BZh91AY&SY`).
Read out of the headers:

| File        | Fields                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SP.CH`     | `CHASSIS`, `MODEL`, `CHASSY`, `VIN`, `MVS`, `ORGANIZATION`, `MOTOR`, `DATE`, `INT_COLOR`                                                                                                                                       |
| `SP.RT`     | table `RTM`: `MOD_TEL`, `VIN`, `CIS`, `TELAIO`, `ORDINE`, `MARCA`, `MODELLO`, `VERSIONE`, `SERIE`, `GUIDA`, `ALLESTMERC`, `COLINT`, `COLEST`, `MERCDEST`, `CODALLSPEC`, `CODOPT`, `CODSPECSC`, `CODGOMM`, `MODCODEP`, `CARATT` |
| `SP.TR`     | table `TA`: `MODELLO`, `TELAIO`, `MATRICOLA`, `PART`                                                                                                                                                                           |
| `SP.RTCHRY` | table `VINCHRYSLER`: `VIN`, `BUILDDATE`, `PATTERN`                                                                                                                                                                             |

### Layout

```
 0   2   "F3"
 2   4   record count
 6   2   records per block
 8  20   reference table positions (5 × uint32, 0 = unused)
28   4   primary index position
32  12   secondary index positions (3 × uint32)
44  20   table name, NUL-padded ASCII
64   1   primary key field count
65  ..   primary key fields (23 bytes each)
     1   secondary index count; per index: 1 byte field count, then its fields
     1   column count
    ..   columns (23 bytes each)
```

A field descriptor is 20 bytes of NUL-padded name, then a type byte
(`1` string, `0` reference), then its offset and width **in the unpacked
record**. A width of `0` means "to the end of the record", which is how
`SP.CH.VIN`, `SP.RT.CARATT` and `SP.RTCHRY.PATTERN` hold variable text.

The primary index is `uint32 count`, then `count` entries of
`key[keyLength], uint32 blockStart, uint32 blockEnd`. Each key is the
**highest** in its block — confirmed on all four files, where the last
record's key equals the index entry exactly. A block is a bare bzip2 stream
holding `recordsPerBlock` records, each prefixed by its own total length.

A packed record stores a reference as a `uint16` index into a reference table
and a string inline, so packed offsets differ from the unpacked `start`
values. Only `SP.CH` has a reference table: 11,033 distinct `MVS` codes,
which 41 million records share.

### The record length prefix is 1 or 2 bytes, and the header does not say

It is 1 for `SP.CH` and 2 for `SP.RT`, `SP.TR` and `SP.RTCHRY`, and nothing in
the header distinguishes them.

Nor does checking that records tile the block: a two-byte length below 256 has
a zero high byte, which a one-byte reader consumes as the first content byte,
and the records then tile just as neatly one byte out of step. `SP.TR` reads
that way and yields a `MODELLO` of `"\0" + "10"` — plausible-looking rubbish.

What settles it is the index's own promise. The last record in a block has the
key the index recorded for it, and a wrong prefix shifts every field so that
equality fails. `@eperx/ktd` tries both and keeps whichever reproduces the key.

### Reading it over HTTP

The index is a sorted fixed-width array, so it is binary-searched over ranged
reads rather than downloaded. `SP.CH`'s index is 20,712 entries of 19 bytes —
393 kB — and a lookup touches about fifteen 19-byte slices plus one
compressed block. A chassis lookup against the 420 MB file therefore costs
roughly 20 kB, and works unchanged in a browser.

**`SP.RT` is the per-vehicle build record**, not an ordering file as an earlier
draft of this document guessed. The Italian names give it away — `TELAIO` is
the chassis number, `GUIDA` the steering side, `COLINT`/`COLEST` the interior
and exterior colours, `MERCDEST` the destination market — and the two that
matter most are **`CODOPT`, the options actually fitted, and `CARATT`, the
vehicle's characteristics**. Those are criteria codes: the specification of one
individual car rather than of a sold version.

### Looking a vehicle up

There are two routes, and only one of them needs this format.

**By VIN type code, available from the Access data alone.** `SP.DB`'s `VIN`
table maps a three-character code to a model — 132 rows, 73 distinct codes —
and a Fiat-group VIN carries that code at positions 4–6, so `ZFA312…` gives
`312`. It is a _router_, not a decoder: `312` reaches three models and six
catalogues (Nuova Panda, Nuova 500 and its Abarth, 500 MY2012 and its Abarth,
New Ypsilon), and across all codes it narrows to 3.4 catalogues on average and
as many as 15.

**By chassis number.** `SP.CH` is looked up with
`MODEL || chassis.padStart(8, "0")` and yields that chassis's `MVS` — the exact
sold version — with its VIN, engine, build date and interior colour. `SP.RT` is
looked up with `MODEL || chassis.padStart(7, "0")` for the build record above.
Both key constructions come from openPER's `Release84VinSearch`, and both are
confirmed against real records.

The chassis number is simply the **VIN's trailing characters**: `SP.CH` keys on
the last 8, `SP.RT` on the last 7. `ZLA84300003084515` gives `3084515`, and
`SP.RT` holds `MOD_TEL = 1013084515`.

Chassis numbers are **not** all numeric. They roll into letters as a series
fills — 884 of `SP.RT`'s 10,487 index keys have one, and the Fiat 500 runs a
`J` series and an `O` series alongside its numeric one. Those runs do not
compare as a single ordered space, so "is this chassis beyond what the disc
holds?" is only answerable _within_ a series.

This route is what makes applicability exact. `CARATT` is _this car's_
characteristics, written with an explicit `|` between type and code —
`CMB|DS`, `CC|1.2`, `L|L2` — where a drawing pattern writes them concatenated.
Same criteria, same grammar, with the boundary marked;
[§5](#5-the-pattern-grammar) normalises the two to one form. openPER notes
that roughly 25% of vehicles have such a record; the rest fall back to the
version.

openPER's `VinSearcher/KtdReader` reads this format and is **MIT**, so its
layout knowledge can be used here with attribution — see
[§7](#7-prior-work). Its structure names (`DbTableHeader`, `IndexBlock`,
`BlockSize`, `DbDataType`) map onto the header seen above, and it checks the
same `F3` magic.

`navi.properties` sets `CHASSIS_QUERY_SOURCE=FILE`, confirming the application
reads chassis data from these files rather than from Access.

## 5. The PATTERN grammar

This decides which parts fit which vehicle. The grammar is **specified and
validated**; what remains unsettled is listed at the end of this section and
in [§8](#8-what-is-not-decoded).

Patterns appear on four columns, and all four share one grammar:

| Column                   | Distinct patterns | Fail to parse   |
| ------------------------ | ----------------- | --------------- |
| `DRAWINGS.PATTERN`       | 6,787             | **0**           |
| `MVS.PATTERN`            | 27,110            | **0**           |
| `MDF_ACT.PATTERN`        | 284               | 1               |
| `TBDATA.TBD_VAL_FORMULA` | 77,141            | 38              |
| **all four**             | **107,957**       | **39** (0.036%) |

81,415 of 114,259 drawings carry a pattern; 532,178 `TBDATA` rows carry a
formula.

### The grammar

```
pattern      := alternatives
alternatives := conjunction ("," conjunction)*     -- OR,  loosest
conjunction  := term ("+" term)*                   -- AND
term         := "!"* atom                          -- NOT
atom         := "(" alternatives ")" | token
token        := [^+,()!\s]+
```

- **`+` is AND, `,` is OR**, and `,` binds loosest, so most patterns are a
  disjunction of conjunctions. `CC1.2+(CMBBZ,CMBBG)` reads as _displacement
  1.2 AND (fuel petrol OR fuel LPG)_.
- **`!` is negation** and applies to an atom, which may be a group: 965
  patterns contain `!(`. It may be separated from its atom by whitespace — 13
  patterns wrap a line between the two — so it is not a token prefix.
- **Parentheses nest** (175 patterns) and are otherwise a plain OR of tokens
  (24,332 groups, against 3,577 containing `+` or further nesting).
- **Adjacency is an implicit AND.** `ECOCF4(AM47,AM55)` means
  `ECOCF4+(AM47,AM55)`, and `(LL1,LL2)KW66+320` likewise. All 147 occurrences
  are exactly adjacent and none is whitespace-separated, which matters —
  see "whitespace" below. It occurs only in `TBD_VAL_FORMULA` (149 of 110,933
  distinct, 53 catalogues) and **never** in `DRAWINGS`, `MVS` or `MDF_ACT`.
- **Whitespace is skipped around operators, but is not itself a separator.**
  Patterns wrap across lines (14,907 contain a newline), yet two bare tokens
  side by side are a parse error. That is deliberate: it is what rejects the 2
  `MDF_ACT.PATTERN` rows holding free-text Italian
  (`NUOVA CENTRALINA CONTROLLO MOTORE`) rather than reading them as criteria
  named `NUOVA` and `CENTRALINA`.
- **`@` is not an operator.** `@MOT` is a `VMK_TYPE` in catalogue `3P`
  ("ALTERNATIVE ENGINES RANGE"), so `!@MOT1` negates the criterion
  `@MOT` + `1`. Type names also contain `/` and `_` (`A/T`, `C_LIN`), which is
  why none of those three characters may be read as syntax.
- **`?` is a token suffix whose meaning is unknown.** It occurs on 3 `MVS`
  rows out of 36,332 and nowhere else, always as `<token>?` before a
  terminator. It is preserved on the parsed criterion rather than dropped, so
  that it cannot be silently read as plain truth.

### Criteria are a type concatenated with a code

A token is `VMK_TYPE || VMK_COD` with **no separator**. `CARAT_DSC` gives the
types for a catalogue and `VMK_DSC` and `CAT_VAL` give the codes. For
`CAT_COD` `33`:

```
CARAT_DSC   CMB → 'FUEL'                    VMK_DSC   CMB BZ → 'PETROL'
            CC  → 'DISPLACEMENT (COMMER.)'            CMB BG → 'GASOLINE / LPG'
            TC  → 'BODYWORK TYPE'                     CMB DS → 'DIESEL'
            A/T → '(ASPIRATED/TURBO)'                 CC  1.2 → '8V.LE 69HP'
            ...  9 types in total                     CC  1.3 → 'JTD'
```

So `CMBBZ` = `CMB` + `BZ`, and `CC1.2` = `CC` + `1.2`. A token may also be a
bare equipment code with no value — `011`, `4VU`, `XAC` — which appears in
`CAT_VAL` as a `VMK_TYPE` with a null `VMK_COD`.

**One source writes the boundary explicitly.** `SP.RT.CARATT`, a vehicle's own
characteristics, uses a `|` between type and code: `CMB|DS`, `CC|1.2`,
`L|L2`, `MERC|3109`. Same criteria and same grammar, but with the split given
rather than inferred. Tokens are normalised to the unseparated form so the two
sources compare, and a criterion the data already split is never re-resolved
against the vocabulary — the data's own boundary wins.

### Tokenisation is unambiguous in practice

Type names are **not** prefix-free. Measured collisions within a single
catalogue:

| Catalogue                    | Colliding types      |
| ---------------------------- | -------------------- |
| `4Y`                         | `CM` and `CMB`       |
| `12`, `13`                   | `G` and `GSS`        |
| `24`, `25`, `32`, `63`, `75` | `C_LIN` and `COLINT` |

So splitting on the type alphabet alone is unsound. Splitting against the
actual `(VMK_TYPE, VMK_COD)` pairs a catalogue holds **is** sound here, and
that is a measurement rather than a hope: across all **4,241,952** token
occurrences in the corpus, **0 split more than one way**.

An earlier draft of this document called tokenisation "provably ambiguous" on
the strength of the type collisions alone. That was wrong, and it was the more
alarming version.

**8,893 token occurrences (0.21%, 920 distinct) do not resolve at all** — a
code a pattern names but the catalogue's vocabulary does not list, such as
`CC1.3` in catalogue `10`. At pattern level that is 0.26% of `DRAWINGS`
patterns, 0.17% of `TBDATA` formulas, 4.06% of `MVS` and 11.68% of `MDF_ACT`.
These stay unresolved so that evaluation reports "unknown" rather than
quietly false.

### The two levels nest

A drawing's pattern selects which vehicles see the diagram at all;
`TBD_VAL_FORMULA` then discriminates between parts _on_ it. Drawing
`33/101/1/20` variant 1 has `PATTERN = CC1.2+(CMBBZ,CMBBG)` and its callout 1
offers two cylinder heads:

```
1.1  71740648  CYLINDER HEAD WITH VALVES COMPL   TBD_VAL_FORMULA = CMBBZ
1.2  71751447  CYLINDER HEAD WITH VALVES         TBD_VAL_FORMULA = CMBBG
```

Any evaluator has to apply both levels.

### Evaluation is three-valued

An `MVS` row is one sold version of a vehicle, and its pattern is a flat
conjunction stating what that version has and — with `!` — what it does not:
`TC2V+CC1.4+KW88+CMBBZ+!XAC+011+!108+…`, typically 50 to 150 tokens. So an
`MVS` pattern is a **specification** where a drawing's pattern is a **query**
over one. All 36,332 parse, and 0 of them have a top-level disjunction, which
is what makes reading them as a set of facts legitimate.

A specification does not mention every criterion in its catalogue, and 0.21%
of tokens do not resolve. Two-valued logic would have to guess on both, so
evaluation is Kleene three-valued — true, false, unknown — and a caller can
decline to answer rather than answer wrongly. In particular `!X` where `X` is
unmentioned is **unknown**, not true.

### Validated by reachability

There is no external answer key for "which parts fit which car", so the
grammar is checked against the data's own consistency. `MVS` lists every sold
version, so a drawing whose pattern no version satisfies is a diagram nobody
could ever be shown. `eperx applicability` measures it over all 223
catalogues:

| Can any version see this drawing? | Drawings |           |
| --------------------------------- | -------- | --------- |
| yes                               | 70,111   | 86.12%    |
| undecided                         | 11,286   | 13.86%    |
| **no**                            | **18**   | **0.02%** |

18 unreachable drawings out of 81,415 is the result that makes the reading
credible. A rise in that number is a regression.

### What is still open

- **`?`** — 3 `MVS` rows, meaning unknown.
- **Whether closing a specification per criteria type is right.** An `MVS`
  pattern states what a version has and negates the equipment it lacks, but
  does not negate the alternatives of a valued characteristic, so a 1.3 diesel
  says nothing about `CC1.2` and a 1.2 drawing evaluates to _unknown_ rather
  than _false_. Valued types are effectively single-valued — 36,331 of 36,332
  specifications give each one exactly one value — so closing them is
  defensible, and without it a parts-by-vehicle filter is unusable. But it
  raises the unreachable-drawing count from 18 to 209, and the 191 that flip
  blame no single type. `eperx applicability` defaults to the open reading and
  takes `--close` to measure the other.
- **Precedence of `!` against an implicit AND.** `!407(CC1.8,CC2.0)` is read
  as `(!407)+(CC1.8,CC2.0)`, the conventional binding for a prefix operator,
  but `!(407+(…))` is also syntactically available and the two differ. 26
  patterns have this shape.
- **How several matching alternatives on one callout are resolved.** Strict
  exclusivity is _not_ a property of the data: `10002-010` callout 1 offers
  ten alternatives including `CC1.3+LL1` and `CC1.3+TT4X4`, and a 1.3 with
  that trim and four-wheel drive satisfies both. Order almost certainly
  decides it — **84,897 of the 84,902 multi-formula callouts give every row a
  distinct `TBD_SEQ`** — but "first match wins" is inferred from the shape of
  the data, not confirmed. Measured over the corpus, exactly one alternative
  applies in 66.82% of cases, several in 11.02%, and none decidably in 22.13%.

  Note that several rows under one callout with _no_ formula are a different
  thing: parts fitted together, not a choice. 104,752 callouts look like that.

- **39 malformed patterns** (0.036%): 29 with unbalanced parentheses
  (`GS+(M1,M2,M3`) and the rest with a `!` that has nothing to negate
  (`129!+5DE`). These are rejected rather than repaired — there is no way to
  close a bracket for the vendor that is not a guess about which parts fit a
  car.

## 6. Established by

| Claim                       | How                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Jet 4, no password          | page 0 magic and version byte; both files open in `mdb-reader` and `mdbtools`                 |
| Row and table counts        | counted, not estimated, on edition 83                                                         |
| Column types in use         | enumerated over all 77 tables of both databases                                               |
| Drawing shards are stored   | `compress_type` tallied over all 261 shards, 228,226 entries                                  |
| `IMG_PATH` layout           | `DRAWINGS` rows resolved to entries and extracted; PNGs decode at 2150×1675                   |
| Drawing↔parts key           | the `DRW_NUM` join returned zero rows; `TABLE_COD, VARIANTE` returns the callouts             |
| PATTERN grammar             | all 107,957 distinct patterns parsed; 39 fail, and `DRAWINGS` and `MVS` fail 0                |
| PATTERN tokens              | all 4,241,952 occurrences split against each catalogue's real `(type, code)` pairs            |
| Tokenisation is unambiguous | 0 of those 4,241,952 split two ways; the type collisions come from a self-join of `CARAT_DSC` |
| Reachability                | every drawing pattern evaluated against every `MVS` of its catalogue — `eperx applicability`  |
| F3 magic and tables         | header hexdump of four files                                                                  |

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
- **`SP.CH` / `SP.TR` / `SP.RT` bodies.** The F3 header parses by eye and the
  field lists are read; the block index and row layout are not implemented, so
  there is no chassis lookup. What each file holds is now known — see
  [§4](#4-spch-sptr-sprt--the-f3-format).
- **`?` in patterns**, and the precedence of `!` against an implicit AND —
  both in [§5](#what-is-still-open), which also records how several matching
  alternatives on one callout are probably resolved (`TBD_SEQ` order) and why
  that is not yet confirmed.
- **`HOTSPOTS`.** A memo on `DRAWINGS`, `TBDATA`, `KIT` and `CPXDATA`, null on
  every row inspected so far. It should be what makes callouts clickable —
  openPER lists "find image maps for drawings" as an open task too.
- **`MAP_GRP` / `MAP_SGRP` / `MAP_VET` / `MAP_INFO`.** Coordinates for the
  graphical group selector. Columns are self-describing; unused so far.
- **`CPXDATA.CLH_COD` is INTEGER while `CLICHE.CLH_COD` is TEXT(40).** Same
  mismatch shape as `GROUPS.GRP_COD`; not yet investigated.
- **`images/` entries with no extension** (657 of them) and the `.db`/`.pptx`
  leftovers. Assumed to be vendor accidents; not verified.
- **`ACTIVATIONS`, `TRANCHE`, `CODES_REC`, `PROMO_*`.** Read and imported,
  semantics not worked out.

`SUBSYSTEM` came off this list: its six rows are the mechanical subsystems in
Italian — `A` _appendice_, `C` _cambio_ (gearbox), `M` _motore_ (engine),
`S` _sospensioni_, `T` _telaio_ (chassis), `Z` _carrozzeria_ (body). The row
count coincidentally matches `MAKES`, which is misleading; the two are
unrelated.
