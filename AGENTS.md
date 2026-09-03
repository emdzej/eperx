# Working on eperx

Notes for anyone — human or agent — changing this repository. Conventions only,
and mostly ones learned by getting them wrong. For how the formats work read
[`docs/data-format.md`](docs/data-format.md); for why the project is shaped
this way read [`docs/plan.md`](docs/plan.md).

This is a parts catalogue. A wrong applicability decision puts a part on a
vehicle it does not fit, and nothing in a green test run will tell you.

## Before you finish

```sh
pnpm typecheck    # NOT just `turbo run typecheck` — see below
pnpm test
node apps/cli/dist/index.js import <a mounted disc> -o /tmp/x -l 3 --no-images
```

`pnpm typecheck` is two things: `turbo run typecheck` over the packages via
`tsc`, **and** `apps/web` separately, because the web app type-checks through
`svelte-check` against its own tsconfig. The package pass does not see the
`.svelte` files at all. Do not substitute one for the other.

An import against a real disc is not optional if you touched `apps/cli` or
`packages/res`. The row counts it prints are the regression test: 55 tables and
5,253,068 rows for English on edition 83.

## Do not reimplement other people's formats

The first version of this repo contained a hand-written Jet 4 reader. It
worked — TDEF layout, row null-bitmasks, the variable-offset table, compressed
text — and it was the wrong thing to build. Access is a solved third-party
format that is not ePER's secret, and `mdb-reader` (MIT) reads both databases
in-process with no external binary.

The licence argument that seemed to justify it does not hold either: PolyForm
cannot _link or copy_ GPL code, but invoking a separate binary is not a
derivative work, and dialogysx already shells out to `hdiutil`.

**The reverse engineering that matters here is the ePER-specific part**: the F3
chassis format, `SP.PL`, the `PATTERN` grammar, the `.res` shard layout, the
Java application's logic. Spend effort there.

`mdbtools` stays useful as a **differential oracle** — an independent reading
of the same file to diff against. That is the right role for it.

## The format doc is the specification and it is kept honest

If you learn something about a layout, update
[`docs/data-format.md`](docs/data-format.md) in the same change. If you find
the doc overstating a claim, weaken it.

That has already happened twice, and both times the wrong version was the more
confident one:

- **"The MDB has no indexes."** Two `mdb-schema` runs reported none, so the
  architecture was briefly justified by their absence. `mdb-schema … sqlite`
  prints them; `APPLICABILITY` alone carries five. The decision to convert was
  still right, for the plain reason rather than the dramatic one.
- **"Every entry in every shard is stored."** True of `00.res`, which is what
  had been checked. 8,973 entries across the four `L_*` shards are deflated,
  and the import found out by throwing on one. All 261 shards are now tallied
  and the doc says which are which.

## Measure, do not estimate

Sizes, timings and counts in this repo are measured numbers and the docs quote
them. Row counts, import time, database size — run it and read the number.
"It should be fast enough" is not a claim this repo makes.

The counts in the docs (8,534,325 rows; 228,226 image entries; 81,415 drawings
with a pattern; 219,253 stored entries) all came from a disc, not from
arithmetic on a guess. `AM.DB`'s row count was `~1,000,000` in a first draft
for about ten minutes; it is 2,466,432.

## Fail loudly rather than plausibly

A wrong answer that renders is worse than an error, because a parts catalogue's
output looks the same either way.

- `resolvePayload` refuses a compression method it does not know instead of
  handing back bytes that are not an image. That is what caught the `L_*`
  shards.
- `image` checks that a range read returned the length it asked for.
- `import` refuses to write into an existing database rather than failing on
  the first `CREATE TABLE`, which read as a mysterious mid-import crash.
- The index list is checked against the real schema. A renamed column fails the
  import instead of building an index that matches nothing.

## Two schema traps that return zero rows

Both were found by running a query and getting nothing back, which is the only
way they show up.

- **`DRAWINGS`→`TBDATA` joins on `(CAT_COD, TABLE_COD, VARIANTE, REVISIONE)`,
  never on `DRW_NUM`.** The tables share a `DRW_NUM` column, which invites the
  wrong join. `DRAWINGS.DRW_NUM` numbers variants for display;
  `TBDATA.DRW_NUM` is `0` on the rows that belong to them. The index in
  `apps/cli/src/indexes.ts` was originally the wrong shape for this reason.
- **`GROUPS.GRP_COD` is TEXT, `GROUPS_DSC.GRP_COD` is INTEGER.** Joining needs
  a cast and SQLite will not warn you.

## Verify a test by breaking it

A test that has never failed has not been shown to work. Change the code so the
bug it describes is present, watch it fail with a message that names the
problem, then restore.

The load-bearing one here is "takes the data offset from the local header, not
the central one". Making `resolvePayload` trust the central directory's extra
length fails it with `expected 43 to be 49` — an off-by-six that would hand
back bytes six into a PNG. Two traps found while doing this:

- **Use absolute paths when you break and restore.** A `cd` in a compound
  shell command persists, so a restore can write to the wrong place and leave
  the broken code on disk.
- **A background dev server does not survive between shell invocations.** Start
  it and test it in the same command, and bind it explicitly — Vite reports
  `localhost` but a request to `127.0.0.1` can still fail to connect.

## Things that are the way they are on purpose

- **Table and column names are the disc's own.** `TBD_RIF`, `VMK_COD`,
  `SGRP_COD`, `MVS`. The data uses them as keys; translating them would add a
  layer to get wrong. Same reason dialogysx keeps `Planches` and `repere`.
- **Nothing keys off the `.FCTLR` suffix**, which covers three unrelated
  formats and two empty directories, and **nothing hardcodes `04147`**, which
  is the data release and changes per edition. `runparam.ini` is the disc's own
  statement of what it ships.
- **`node:sqlite` is loaded through `apps/cli/src/sqlite.ts`.** Node emits an
  `ExperimentalWarning` when it _links_ the builtin, before any user module
  body runs, so a static import anywhere in the entry graph prints it no matter
  how early a filter is installed. The dynamic import is not decoration.
- **SQLite `page_size` is 4096 and set before the first write.** Every browser
  read is one page over `Range`.
- **`journal_mode=OFF` and `synchronous=OFF` during import.** The output is
  read-only afterwards, so durability during a build that can simply be re-run
  buys nothing and costs a lot of time.
- **The image index stores each entry's compression method.** Not because
  drawings need it — they never do — but because a reader that wanders into
  `L_EPERTESSUTI` must find out from the data.

## Repository facts

- **PolyForm Noncommercial 1.0.0.**
- **openPER is MIT**, so its schema knowledge and code may be used here with
  attribution. This is the _opposite_ of the rule in the sibling repo
  dialogysx, whose counterpart ddtx is GPL and must be kept at arm's length.
  Do not import that rule by reflex.
- **The catalogue data is not ours and is not committed.** `data/` and
  `re/extract/` are git-ignored. Never add a fixture derived from a disc, and
  never put a VIN in a commit, test, or doc.
- **Out of scope by decision:** pricing (`SP.PL`), ordering and DMS
  (`eplus_*`, `it.keytech.dms`), and licensing (`CodeVerifier.dll`,
  `WEB-INF/lib/*.LIC`). Document their formats if they share machinery; build
  no features.

## Known gaps

Honest list, so nobody reports these as discoveries.

- **The `PATTERN` grammar is not verified.** This is the critical path: it
  decides which parts fit which vehicle. `+`/`,`/`()` are established and
  tokens are `VMK_TYPE || VMK_COD`, but `!`, `@` and `?` are unexplained and
  **tokenisation is provably ambiguous** where type names collide (`CM` vs
  `CMB` in catalogue `4Y`; `G` vs `GSS`; `C_LIN` vs `COLINT`). Until there are
  known-answer tests there is no parts-by-vehicle view.
- **No F3 reader**, so no VIN search. Header parses by eye only.
- **`HOTSPOTS` is null on every row inspected**, so callouts are not clickable.
  openPER has the same gap.
- **Only `packages/res` has tests.** Eight of them, on synthetic archives.
  `apps/cli` has none, so the import against a real disc is its only
  regression check and it is manual.
- **The web app is a harness, not a product.** It reads a shard and renders a
  drawing; it does not read `catalogue.sqlite` at all, so there is no
  hierarchy, callout list or part search in the UI yet.
- **Only tested against edition 83.** openPER targets 84 and documents
  differences; they are not reconciled.
- **Only macOS has been used to mount the ISO.** The CLI takes a mount point
  and does no mounting itself, so it should be platform-neutral, but that is
  untested.

## Commit messages

Say what changed and _why_, including the mistake that motivated it, in prose.
If a number justified the change, quote it. If a claim in the docs turned out
to be too strong, say what the measurement was — that is the most useful kind
of commit message this repository has.
