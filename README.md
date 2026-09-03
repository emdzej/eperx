# eperx

Fiat group parts catalogue — Fiat, Lancia, Alfa Romeo, Abarth, LCV, Chrysler —
in the browser, reading the original ePER data client-side with no backend.

A reimplementation of **ePER 8.3** (edition 83, data release 4147),
reverse-engineered from the shipped Java application and its data files. It
ships **without data**: bring a DVD or point it at your own static tree.

> **No warranty.** The catalogue data is Fiat's, is not redistributed here, and
> nothing in this repository is derived from it. Part applicability is
> reconstructed and **not yet verified** — see [Status](#status) before
> trusting a parts list against a real vehicle.

## Status

**The disc reads end to end.** A `DRAWINGS` row resolves to a 2150×1675 PNG
pulled straight out of the vendor's own archive, and the full catalogue
converts in 97 seconds.

Working today:

- `@eperx/res` — reader for the `images/*.res` drawing shards, over HTTP
  `Range`, a local file, or Node `fs`, behind one `read(pos, len)`.
- `eperx` CLI — `disc`, `tables`, `import`, `image`.
- A browser client that opens a shard over `Range` and renders a drawing —
  **118.9 kB transferred out of an 18.8 MB archive, 0.65%**, measured against
  a real HTTP server.
- 55 tables and 8,534,325 rows understood, with the hierarchy and the
  description joins mapped.

Measured on edition 83: the English-only catalogue is **536 MB** and
**5,253,068 rows** with 41 indexes, built in **43 s**; indexing all
**228,226** drawing entries across **261 shards** takes another **54 s**.

**Not working yet:** the `PATTERN` grammar, which decides _which parts fit
which vehicle_. It is characterised — `+` is AND, `,` is OR, `()` groups, and a
token is a criteria type concatenated with its code — but tokenisation is
provably ambiguous in some catalogues and there are no known-answer tests, so
there is no parts-by-vehicle view. See
[`docs/plan.md`](docs/plan.md) phase 3 and
[`docs/data-format.md`](docs/data-format.md) §5.

## Why the drawings need no conversion

`images/*.res` are ZIP archives, and all **219,253** drawing entries in them
are _stored_ rather than deflated. A stored entry is a byte range holding the
file itself — the shape of an HTTP `Range` request. So a static host serves the
vendor's own `.res` files and the browser pulls one PNG out of a 19 MB archive
with a single request. **4.7 GB of drawings pass through untouched.**

Measured, opening shard `2E.res` (18.8 MB, 840 entries) and rendering one
drawing: two requests and 69.5 kB for the central directory, then two more and
49.3 kB for the PNG itself — **0.65% of the archive**.

The catalogue is the other half of the story: `SP.DB` is an Access database, so
`eperx import` converts it to SQLite once, with indexes chosen for the queries
the client makes. Full reasoning in [`docs/plan.md`](docs/plan.md).

## Documentation

- [`docs/data-format.md`](docs/data-format.md) — **the format reference.** All
  three storage formats on the disc, the catalogue hierarchy, the two schema
  traps that return zero rows if you get them wrong, the `PATTERN` grammar with
  its measured ambiguity, and an honest list of what is still undecoded.
- [`docs/plan.md`](docs/plan.md) — why the project is shaped this way: sizing,
  the convert-or-not decision per data type, phase order, ranked risks.

## Running it

```sh
pnpm install
pnpm build
```

### Read a disc

```sh
cli=apps/cli/dist/index.js

# What this disc carries, and which release
node $cli disc /Volumes/ePER\ ed.83

# Every table with its row count and columns
node $cli tables /Volumes/ePER\ ed.83
node $cli tables /Volumes/ePER\ ed.83 -b accessories
```

### Import into a static tree

```sh
# Everything, all 20 languages
node $cli import /Volumes/ePER\ ed.83 -o data

# English only, catalogue and drawings — 536 MB plus the shards
node $cli import /Volumes/ePER\ ed.83 -o data -l 3

# Leave the 4.7 GB of shards on the disc and index them where they sit
node $cli import /Volumes/ePER\ ed.83 -o data -l 3 --index-images-in-place

# Catalogue only
node $cli import /Volumes/ePER\ ed.83 -o data -l 3 --no-images --no-accessories
```

`-l` takes `LNG_COD` values from the `LANG` table (`0` Italian, `3` English,
`4` German, `N` Russian, …). It is the main size lever: the per-language
description tables are about 62% of all rows.

### Pull out a drawing

```sh
node $cli image "BA/BA061CCF4B1E35C4D1CD4DF5A6B37B1B.png" -d data -o drawing.png
node $cli image "BA/BA061CCF4B1E35C4D1CD4DF5A6B37B1B.png" -d data -o thumb.png --thumbnail
```

### Query the catalogue directly

The imported file is ordinary SQLite, with the disc's own table and column
names:

```sh
sqlite3 data/catalogue.sqlite "
  SELECT d.DRW_NUM, d.TABLE_COD, d.IMG_PATH, d.PATTERN
  FROM DRAWINGS d
  WHERE d.CAT_COD='33' AND d.GRP_COD=101 AND d.SGRP_COD=1"
```

Two joins to get right, both of which silently return nothing otherwise:
`DRAWINGS`→`TBDATA` is on `(CAT_COD, TABLE_COD, VARIANTE, REVISIONE)` and
**not** `DRW_NUM`; and `GROUPS.GRP_COD` is TEXT while `GROUPS_DSC.GRP_COD` is
INTEGER. Both are in
[`docs/data-format.md` §2](docs/data-format.md#2-spdb-and-amdb--access-jet-4).

### Run the browser client

`pnpm dev` serves an imported tree — or a mounted disc's `data/` — at `/data`,
honouring `Range`:

```sh
EPERX_DATA="/Volumes/ePER ed.83/data" pnpm dev
```

Then open shard `2E` and pick an entry. The footer shows how many bytes were
actually transferred, which is the claim above made checkable.

The client **rejects a host that ignores `Range`** rather than reading the
wrong bytes out of a full-body response.

| Script           | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| `pnpm build`     | Build every package and the web app                   |
| `pnpm dev`       | Run the browser client (see `EPERX_DATA` above)       |
| `pnpm test`      | Unit tests                                            |
| `pnpm typecheck` | Packages via `tsc`, the Svelte app via `svelte-check` |
| `pnpm check`     | Build, typecheck and test                             |

## Layout

```
apps/
  cli        disc tooling: inspect, import, extract
  web        Svelte 5 + Vite browser client
packages/
  core       shared types and the ByteSource primitive
  res        the drawing-shard reader
docs/
re/tools/    reverse-engineering scratch
```

## Prior work

[**openPER**](https://github.com/CReynolds/openPER) by Christopher Reynolds is
an ASP.NET reimplementation against release 84, and it got there first on the
schema and on the F3 chassis format. It is MIT licensed, so eperx uses its
knowledge with attribution.

## Licence

**PolyForm Noncommercial 1.0.0** — see [`LICENSE.md`](LICENSE.md).

The ePER data is **not** covered by this licence, is not ours, and is not
redistributed. `data/` and the reverse-engineering working directories are
git-ignored.
