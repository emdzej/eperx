# eperx

Fiat group parts catalogue — Fiat, Lancia, Alfa Romeo, Abarth, LCV, Chrysler —
in the browser, reading the original ePER data client-side with no backend.

A reimplementation of **ePER 8.3** (edition 83, data release 4147),
reverse-engineered from the shipped Java application and its data files. It
ships **without data**: bring a disc, or point it at a tree you already have.

> **No warranty.** The catalogue data is Fiat's, is not redistributed here, and
> nothing in this repository is derived from it. Which parts fit which vehicle
> is **reconstructed and never verified against a real car** — see
> [Applicability](#applicability-is-reconstructed) before trusting a parts list.

## Try it

**[eperx.emdzej.pl](https://eperx.emdzej.pl)** — the client, deployed from
`main`.

A fresh visit lands on the source picker, because there is no data to show
until you supply some. Two of the three options need nothing but a folder:

| Source                       | What it does                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Over HTTP**                | Any static host that honours `Range` — `eperx serve`, or a URL. Nothing is stored in the browser.                                       |
| **A folder on this machine** | Read in place, **nothing copied**. A service worker answers the reads, so 5.7 GB of drawings and chassis files stay put. Chromium only. |
| **Stored in this browser**   | Copied into the origin private file system: opens on reload with no permission prompt and no disc mounted. Checked against the quota.   |

The choice is remembered. HTTP and browser storage reopen silently; a saved
folder may need one click, because browsers grant directory access per session.

The HTTP option works from the deployed site against `eperx serve` on your own
machine — loopback is a trustworthy origin, so it is not mixed content, and
`serve` sends the header Chrome's Private Network Access wants from a public
page.

## What works

- **Browsing.** Marque → model → catalogue → group → subgroup → drawing, with
  the diagram, its numbered callout list, part-number search, and every drawing
  a part appears on.
- **Parts by vehicle**, chosen by version or by VIN. Drawings and callouts are
  scored fits / does not fit / not determined; a 1.3 JTD Panda narrows a
  subgroup from 13 drawings to 3.
- **VIN lookup.** A chassis number resolves to its exact sold version, engine
  number, build date, and the options and characteristics it left the factory
  with.
- **`eperx` CLI** — `disc`, `tables`, `import`, `serve`, `browse`, `part`,
  `applicability`, `vin`, `f3`, `image`.

Measured on edition 83. Importing the English-only catalogue gives **568 MB**
and **5,253,068 rows** with 41 indexes in **43 s**; indexing all **228,226**
drawing entries across **261 shards** takes another **54 s**.

In the browser, a whole session — connect, walk to a drawing, read its
callouts, search a part number, list its 200 usages — costs **92 requests and
597 kB of that 568 MB database**, 0.11%, plus 49 kB for the drawing itself. A
VIN lookup against the 420 MB chassis file costs about **20 kB**.

## Why so little is downloaded

**The drawings need no conversion at all.** `images/*.res` are ZIP archives,
and all **219,253** entries in the 256 drawing shards are _stored_ rather than
deflated. A stored entry is a byte range holding the file itself — the shape of
an HTTP `Range` request. So a static host serves the vendor's own `.res` files
and the browser pulls one PNG out of a 19 MB archive with a single request.
**4.7 GB of drawings pass through untouched.**

**The catalogue does.** `SP.DB` is an Access database, and Jet addresses rows
through its own B-tree pages, so `eperx import` converts it to SQLite once with
indexes chosen for the queries the client actually makes. The browser then runs
real SQL against it a 4 kB page at a time.

**The chassis files need none either.** F3 — ePER's own format — is already a
blocked store with a sparse index, so its index is binary-searched over ranged
reads rather than downloaded.

Three sources of bytes, one transport: everything reads HTTP `Range`, and a
service worker makes local files answer that too. Full reasoning in
[`docs/plan.md`](docs/plan.md).

## Applicability is reconstructed

`PATTERN` decides which parts fit which vehicle. It is specified, implemented
and tested: all **107,957** distinct patterns parse bar 39 malformed ones,
`DRAWINGS` and `MVS` parse at 100%, and evaluation is three-valued so "not
known" is an answer rather than a guess.

There is no external answer key, so it is validated against the data's own
consistency instead: `MVS` lists every sold version, so a drawing no version
can see is dead data. Across all 223 catalogues, **18 of 81,415 drawings are
unreachable (0.02%)**. `eperx applicability` reports that number and a rise in
it is a regression.

**None of that is a check against a real vehicle.** Only a definite non-fit is
ever hidden — "not determined" is always shown, because declining to answer
must not look like an answer. What is still open is listed in
[`docs/data-format.md` §5](docs/data-format.md#5-the-pattern-grammar).

## Documentation

- [`docs/data-format.md`](docs/data-format.md) — **the format reference.** All
  three storage formats on the disc, the catalogue hierarchy, the schema traps
  that return zero rows if you get them wrong, the `PATTERN` grammar, and an
  honest list of what is still undecoded.
- [`docs/plan.md`](docs/plan.md) — why the project is shaped this way: sizing,
  the convert-or-not decision per data type, phase order, ranked risks.
- [`AGENTS.md`](AGENTS.md) — conventions for changing the code, and the
  mistakes that motivated them.

## Running it

```sh
pnpm install
pnpm build
```

| Script           | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| `pnpm build`     | Build every package and the web app                   |
| `pnpm dev`       | Run the browser client                                |
| `pnpm preview`   | Serve the production bundle                           |
| `pnpm test`      | Unit tests                                            |
| `pnpm typecheck` | Packages via `tsc`, the Svelte app via `svelte-check` |
| `pnpm check`     | Build, typecheck and test                             |

### Read a disc

```sh
cli=apps/cli/dist/index.js

node $cli disc /Volumes/ePER\ ed.83                # what it carries, which release
node $cli tables /Volumes/ePER\ ed.83              # every table, row count, columns
node $cli tables /Volumes/ePER\ ed.83 -b accessories
```

### Import into a static tree

```sh
# Everything, all 20 languages
node $cli import /Volumes/ePER\ ed.83 -o data

# English only — 568 MB of catalogue, plus 5.1 GB of shards copied
node $cli import /Volumes/ePER\ ed.83 -o data -l 3

# Symlink the shards and chassis files instead of copying 5.7 GB. The tree is
# then 742 MB rather than 6.4 GB, and needs the disc to stay mounted.
node $cli import /Volumes/ePER\ ed.83 -o data -l 3 --link

# Index the shards where they sit and copy nothing. The catalogue knows their
# byte ranges, but the tree has no `images/` for a client to read.
node $cli import /Volumes/ePER\ ed.83 -o data -l 3 --index-images-in-place

# Catalogue only
node $cli import /Volumes/ePER\ ed.83 -o data -l 3 --no-images --no-accessories
```

`-l` takes `LNG_COD` values from the `LANG` table (`0` Italian, `3` English,
`4` German, `N` Russian, …). It is the main size lever: the per-language
description tables are about 62% of all rows.

### Serve a tree, and the app

```sh
node $cli serve -d data                          # the tree: Range + CORS
node $cli serve -d apps/web/dist -p 8080 --spa   # the built client
```

A read-only static file server, which is all either half needs — and the
deployment story made runnable. It prints a running count of requests and bytes
sent, so it is visible that the client reads pages rather than downloading
files. `--spa` serves `index.html` for extensionless paths and is only for
hosting the client: a data tree wants a plain 404, so a missing shard is
reported rather than answered with a web page.

`pnpm dev` can serve a tree itself at `/data` with `EPERX_DATA="$PWD/data"` —
an **absolute** path, because Vite runs with `apps/web` as its working
directory. `eperx serve` is usually simpler, and keeps the data independent of
the dev server.

### Browse and search from the CLI

The same queries the browser makes, against a local tree — which is how the SQL
gets checked without a browser:

```sh
node $cli browse -d data                     # marques and their models
node $cli browse -d data -c 33               # groups in one catalogue
node $cli browse -d data -c 33 -g 101        # its subgroups
node $cli browse -d data -c 33 -g 101 -s 1   # drawings, with callouts
node $cli part 55189942 -d data              # a part, what it fits, what replaced it
```

### Look a vehicle up

```sh
node $cli vin ZLA84300003084515 -D /Volumes/ePER\ ed.83 -d data
node $cli vin -D /Volumes/ePER\ ed.83 -d data -m 101 -c 3084515

node $cli f3 "/Volumes/ePER ed.83/data/SP.CH.04147.FCTLR"   # inspect an F3 file
```

A Fiat-group VIN carries the model type code and the chassis number, which is
how ePER's own index is keyed, so nothing VIN-specific is needed beyond
splitting the two out.

A disc is a snapshot, so a car built after it was pressed is simply absent —
which the lookup reports as such, scoped to the chassis series, rather than as
a flat "not found".

### Check the applicability grammar

```sh
node $cli applicability -d data           # all 223 catalogues, ~30 s
node $cli applicability -d data -c 33     # just one
```

It parses every pattern and reports how many drawings no vehicle version can
reach. That number is the regression test for the grammar.

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

Three joins to get right, all of which silently return nothing or the wrong
thing otherwise: `DRAWINGS`→`TBDATA` is on
`(CAT_COD, TABLE_COD, VARIANTE, REVISIONE)` and **not** `DRW_NUM`;
`GROUPS.GRP_COD` is TEXT while `GROUPS_DSC.GRP_COD` is INTEGER; and `MAKES`
joins to `CATALOGUES.MK2_COD`, not `MK_COD`. All three are in
[`docs/data-format.md` §2](docs/data-format.md#2-spdb-and-amdb--access-jet-4).

## Layout

```
apps/
  cli        disc tooling: inspect, import, serve, query
  web        Svelte 5 + Vite browser client
packages/
  core       shared types and the ByteSource primitive
  catalogue  the queries, the PATTERN grammar, the applicability evaluator
  ktd        the F3 chassis reader
  res        the drawing-shard reader
docs/
re/tools/    reverse-engineering scratch
```

`.github/workflows/ci.yml` builds, typechecks and tests on push and pull
request. `pages.yml` deploys `apps/web/dist` to GitHub Pages.

## Prior work

[**openPER**](https://github.com/CReynolds/openPER) by Christopher Reynolds is
an ASP.NET reimplementation against release 84, and it got there first on the
schema and on the F3 chassis format. It is MIT licensed, so eperx uses its
knowledge and its layout documentation with attribution.

## Licence

**PolyForm Noncommercial 1.0.0** — see [`LICENSE.md`](LICENSE.md).

The ePER data is **not** covered by this licence, is not ours, and is not
redistributed. `data/` and the reverse-engineering working directories are
git-ignored.
