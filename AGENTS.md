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
node apps/cli/dist/index.js browse -d /tmp/x -c 33 -g 101 -s 1
node apps/cli/dist/index.js applicability -d /tmp/x
```

`.github/workflows/ci.yml` runs the first two on every push and pull request.
The disc-backed ones it cannot: the disc is not ours to ship, so those stay
manual and this list is the only place they are written down.

`pnpm typecheck` is two things: `turbo run typecheck` over the packages via
`tsc`, **and** `apps/web` separately, because the web app type-checks through
`svelte-check` against its own tsconfig. The package pass does not see the
`.svelte` files at all. Do not substitute one for the other.

An import against a real disc is not optional if you touched `apps/cli` or
`packages/res`. The row counts it prints are the regression test: 55 tables and
5,253,068 rows for English on edition 83.

`browse` is not optional if you touched `@eperx/catalogue`. It runs the same
SQL the browser runs, so a join that comes back empty shows up here in a
second instead of as a blank panel in a screenshot. On edition 83 that command
prints 13 drawings, the first being `CRANKCASE` `10101-010` variant 1 with six
callouts.

`applicability` is not optional if you touched `pattern.ts`. It parses all
107,957 patterns and evaluates every drawing against every vehicle version of
its catalogue. The numbers to match on edition 83: **39 patterns fail to
parse** and **18 of 81,415 drawings are unreachable**. A rise in either is a
regression, and the unreachable count is the only evidence this repo has that
the grammar is read correctly.

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

## Schema traps that fail silently

Every one of these was found by running a query and getting a wrong or empty
answer back, which is the only way they show up.

- **`DRAWINGS`→`TBDATA` joins on `(CAT_COD, TABLE_COD, VARIANTE, REVISIONE)`,
  never on `DRW_NUM`.** The tables share a `DRW_NUM` column, which invites the
  wrong join. `DRAWINGS.DRW_NUM` numbers variants for display;
  `TBDATA.DRW_NUM` is `0` on the rows that belong to them. The index in
  `apps/cli/src/indexes.ts` was originally the wrong shape for this reason.
- **`GROUPS.GRP_COD` is TEXT, `GROUPS_DSC.GRP_COD` is INTEGER.** Joining needs
  a cast and SQLite will not warn you.
- **`MAKES` joins to `CATALOGUES.MK2_COD`, not `MK_COD`.** `MK2_COD` is the
  marque; `MK_COD` is the parent brand it is billed under, and LCV and ABARTH
  are both billed as FIAT. The same-named columns make the wrong join look
  right, and it produces three rows labelled "FIAT" instead of five marques.
- **A callout's name comes from `CODES_DSC` via `CDS_COD`.** `DESC_AGG_DSC`
  via `TBD_AGG_DSC` is only a qualifier (`DIAM 14`) and is null on most rows,
  so using it alone yields a mostly nameless parts list.

## Query plans are part of the interface

The database is read over HTTP a page at a time, so a bad plan is not slow —
it is megabytes. Check `EXPLAIN QUERY PLAN` before adding a query; `SCAN` on
anything large is a defect.

Two that were already caught, both with numbers in
[`docs/plan.md`](docs/plan.md):

- **`LIKE 'prefix%'` does not use an index.** `case_sensitive_like` is off by
  default, so `LIKE` is case-insensitive and no BINARY index applies. One part
  search scanned all 1,415,102 rows of `PARTS`: **786 requests, 126 MB**. Use a
  range (`>= ? AND < ?`); `prefixRange` computes the bound.
- **Where-used needs its index to be covering.** With a narrow `(PRT_COD)`
  index each of a part's up-to-2,824 matches costs a row fetch. Widening it
  took one lookup from 672 requests / 3.0 MB to 21 / 220 kB. It must _replace_
  the narrow index — with both present the planner picks the smaller one and
  fetches rows anyway.

`import` runs `ANALYZE`, not `PRAGMA optimize`: optimize only analyses tables
it thinks need it from query history, and a fresh database has none. The
resulting `sqlite_stat1` travels inside the file, so the browser plans the way
this was tuned.

## The applicability grammar has no answer key, so it is checked sideways

There is no list of which parts fit which car to test against. What there is,
is the data's own consistency: `MVS` lists every sold version of a vehicle, so
a drawing whose pattern **no** version satisfies is a diagram nobody could ever
be shown. 18 of 81,415 is credible; 8,000 would mean the evaluator is wrong.
That is the whole safety net — treat it as such.

Three rules follow from that:

- **Three-valued logic is not decoration.** A version's pattern does not
  mention every criterion, and 0.21% of tokens name a code the catalogue does
  not list. `!X` where `X` is unmentioned is **unknown**, not true. Collapsing
  to a boolean anywhere puts parts on cars.
- **Malformed patterns are rejected, not repaired.** 39 of 107,957 have
  unbalanced parentheses or a dangling `!`. Closing a bracket for the vendor
  is guessing which parts fit.
- **Do not claim exclusivity between a callout's alternatives.** It is not a
  property of the data — `CC1.3+LL1` and `CC1.3+TT4X4` can both match. Order
  (`TBD_SEQ`) almost certainly decides, but that is inferred, and the report
  presents it as a characterisation rather than a check for that reason.

## Verify a test by breaking it

A test that has never failed has not been shown to work. Change the code so the
bug it describes is present, watch it fail with a message that names the
problem, then restore.

Two load-bearing ones:

- "takes the data offset from the local header, not the central one". Making
  `resolvePayload` trust the central directory's extra length fails it with
  `expected 43 to be 49` — an off-by-six that would hand back bytes six into a
  PNG.
- "requires adjacency for implicit AND, so free text stays an error". Letting
  `parseConjunction` skip whitespace before testing adjacency fails that test
  _and_ "refuses free text" — two failures, because whitespace would become a
  separator and `NUOVA CENTRALINA CONTROLLO MOTORE` would parse into four
  criteria.

Traps found while doing this:

- **Use absolute paths when you break and restore.** A `cd` in a compound
  shell command persists, so a restore can write to the wrong place and leave
  the broken code on disk.
- **A background dev server does not survive between shell invocations.** Start
  it and test it in the same command, and bind it explicitly with
  `--host 127.0.0.1` — Vite reports `localhost` but a request to `127.0.0.1`
  can still fail to connect.
- **`npx` can hang.** It did, for minutes, with only the `npm exec` wrapper
  alive and no vite process behind it. Call the binary —
  `node node_modules/vite/bin/vite.js` — and give startup 30s before
  concluding anything is wrong.
- **The folder picker cannot be automated.** An OPFS directory handle is the
  same type `showDirectoryPicker` returns, so staging a tree in an OPFS
  subdirectory and mounting _that_ exercises the identical code path. That is
  how the directory mode is tested.
- **Check that an edit applied.** `pnpm format` reflows these files, so an
  exact-match edit written against remembered text silently matches nothing.
  Two index changes were "made" and then found still absent from the built
  output. Grep for the result.
- **Vite has refused to start in this environment**, repeatedly: the process
  spawns, prints nothing, and never listens. `npx` has hung the same way with
  only the `npm exec` wrapper alive. Neither is a code fault — call the binary
  directly (`node node_modules/vite/bin/vite.js`), give it 30s, and if it is
  still silent use `eperx serve -d apps/web/dist --spa` instead. The built app
  is static files and should never need a dev server to be usable.
- **Do not `pkill -f vite`.** The process list carries whole shell wrappers, so
  a broad pattern matches the invoking shell and takes its environment with it
  — `curl`, `ls` and `head` all vanished mid-command once. Match the full
  binary path.

## Reading F3 has two traps that produce plausible rubbish

Both are in [`docs/data-format.md` §4](docs/data-format.md#4-spch-sptr-sprt--the-f3-format),
and both were found the hard way.

- **The record length prefix is 1 byte or 2, and the header does not say
  which.** Checking that records tile the block cannot tell them apart: a
  two-byte length below 256 has a zero high byte, which a one-byte reader eats
  as the first content byte, and the records tile just as neatly one byte out
  of step. `SP.TR` read that way and gave a `MODELLO` of `"\0" + "10"`. What
  settles it is the index's promise that a block's last record carries the key
  the index recorded — `detectPrefixSize` tries both and keeps whichever
  reproduces it.
- **The index records block _maxima_, so it cannot answer "the highest key
  under this prefix".** A run ending at `1010000400` sits inside a block
  indexed `1500000100`, so scanning index keys understates the answer. A test
  caught that. `highestKeyUnder` reads the containing block.

And one that is not a trap but is easy to get wrong: **chassis numbers are not
all numeric.** They roll into letters as a series fills, so the Fiat 500 has a
numeric run, a `J` run and an `O` run. Those do not compare as one ordered
space, and "is this chassis beyond what the disc holds?" is only answerable
within a series.

## Local data goes through a service worker, and that is not incidental

Three sources — a remote host, a folder the user picked, and a tree copied into
OPFS — and **one transport**. Everything above `lib/mount.ts` issues HTTP
`Range` requests, and `public/sw.js` makes local files answer them.

The reason is not tidiness. SQLite's VFS reads are **synchronous**, and the
only synchronous file access a browser offers is `createSyncAccessHandle()`,
which works on OPFS files and nothing else — verified in a worker, where it is
also the only place it exists. A picked directory can only be read
asynchronously. Answering `fetch` is asynchronous by nature, so routing through
a worker turns the async file API into the one thing SQLite can consume.

The alternative was copying `catalogue.sqlite` into OPFS so SQLite could read
it — 568 MB duplicated to open a folder. This copies nothing, and it means the
OPFS mode needs no second VFS either.

Two lifecycle details are load-bearing, and both fail as "file not found":

- **Wait for the worker to control the page.** A freshly registered worker does
  not control the page that registered it until it activates and claims
  clients; a fetch before that goes to the network and 404s.
- **Wait for the mount to be acknowledged.** Posting a directory handle and
  immediately fetching races the worker's message queue.

`sw.js` handles `HEAD` and suffix ranges (`bytes=-N`) as well as normal ones —
`HEAD` is how a client learns a file's size, and the suffix form is how a ZIP's
end-of-central-directory gets found.

## A folder cannot be remembered in localStorage

`localStorage` holds the _choice_ — which source, and the URL for a remote
one. The **directory handle goes in IndexedDB**, because a
`FileSystemDirectoryHandle` is not JSON: `JSON.stringify` turns it into `{}`,
a silent loss that reads as "the folder was forgotten". It _is_
structured-cloneable, which is what IndexedDB takes.

The handle surviving is not the same as being usable. Browsers grant directory
read access per session, so `queryPermission` can come back `prompt` on a
later visit and re-granting **needs a user gesture** — `requestPermission`
throws without one. So `readSettings` queries rather than requests, and
reports which case it is; the UI offers a button for `prompt` instead of
failing at the first read. HTTP and OPFS need no permission and resume
silently.

## The browser's SQLite is fussy, and three fixes are load-bearing

- **`pool.exec` does not return rows.** It is typed `RowObject[]` but returns
  worker-1 protocol _messages_ — `{ type, columnNames, rowNumber, row }` — with
  the row nested inside. Treating the envelope as the row gives objects whose
  every column is `undefined`, which renders as a list of blank entries rather
  than an error. `rowsFrom` unwraps it.
- **`sqlite-wasm-http` is patched.** It builds its workers with
  `new Worker(url)` and no `{ type: "module" }`, which webpack rewrites and
  Vite does not — in dev the worker loads as a classic script, hits an ES
  `import`, and dies with "Worker bootstrap failed". The patch is in `patches/`
  and registered in `pnpm-workspace.yaml`. Do not drop it.
- **`bz2` exports nothing in a browser.** It ends with
  `if (typeof window !== "undefined") window.bz2 = exports; else module.exports = exports`,
  so a bundler gets an empty module and the global is the only way in.
  `packages/ktd/src/bzip2.ts` looks in both places. It is used rather than
  `seek-bzip` — also MIT, and 4× faster — because `seek-bzip` builds its output
  with Node's `Buffer` and dies with "Buffer is not defined" in a browser.
- **`optimizeDeps.exclude` and `worker.format: "es"` are both required.** The
  pre-bundler rewrites the package's worker URLs and breaks them; the default
  `iife` worker format cannot express the SQLite worker's code splitting and
  fails the production build outright.

The backend is pinned to `sync` deliberately. The shared-cache one needs
`SharedArrayBuffer`, which needs COOP/COEP headers on the origin — and
requiring those of whoever hosts the tree would undo the point of it being
servable from anywhere.

**Do not add a byte counter to the UI.** SQLite fetches its pages inside a
worker, whose resource timings the main thread cannot see; an earlier version
counted that way and reported a confident `0 kB` for every query. Page traffic
is measured server-side by the dev middleware — set `EPERX_TRACE=1`, or read
`/__eperx-traffic`.

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

## The interface borrows deliberately, and the borrowing has limits

Two siblings are drawn on, for different reasons:

- **`uci`** supplies the theme — the Italian tricolor palette and the semantic
  token names (`bg-surface`, `text-foreground`, `border-divider`,
  `text-accent`) — and the combobox. Reusing its component conventions is
  intended: a component should be able to move between the two unchanged.
- **`ddtx`** supplies the _arrangement_ of the top bar and the About dialog:
  wordmark as the button, version beside it linking to that release with no
  `v` prefix, and a dialog that ends with the disclaimer styled loudest.
  **ddtx is GPL and eperx is PolyForm, so nothing is taken but the shape.**
  eperx's own words, its own tokens.

What the layout is for, so it does not drift back:

- **Marque, model, catalogue and vehicle are searchable dropdowns across the
  top; group and subgroup are lists down the left.** A five-column cascade
  showed the whole path at once but cost 960px, leaving the drawing a sliver —
  it is now 782×609. A catalogue also runs to 223 entries and a vehicle to
  10,436 versions, which a column cannot present and a search can. Group and
  subgroup stayed lists because they are short and they are what you move
  around in.
- **The combobox skips local filtering when `onsearch` is given.** Re-filtering
  results the server matched would hide rows matched on a field the component
  cannot see.
- **VIN lookup is a button beside the vehicle dropdown, not an item in it.** A
  VIN needs a form and a form does not belong inside a listbox.
- **Verdicts carry a glyph as well as a colour** (✓ ✗ ?). Amber and red are
  hard to tell apart at that size and impossible for some readers, and the
  distinction between "does not fit" and "not determined" is the entire point
  of three-valued logic. I misread them off a screenshot myself and thought the
  filter was broken.
- **The version is a build-time literal**, injected by `define` from the root
  manifest. Importing `package.json` would ship it to the browser and let the
  displayed version drift from the tag a release is cut from.

## The deploy bakes in a path, so the path has to be decided first

Vite writes `base` into every asset URL at build time and a built bundle
cannot be relocated. A custom domain serves from the root; the default
`<user>.github.io/<repo>/` serves from a prefix. So `pages.yml` decides from
one signal — **the presence of `apps/web/public/CNAME`**, which is the same
file GitHub reads to keep the domain attached. One fact, one place, and a fork
without a CNAME still gets a working prefixed build.

Two things make that safe, and both were bugs waiting to happen:

- **`BASE_PATH` is declared in `turbo.json`'s `env`.** Without it, building
  again with a different base is a cache hit that replays the wrong asset
  paths. The failure is nasty because `index.html` still returns 200: the page
  loads and every asset 404s. `pages.yml` greps the built HTML to catch it.
- **The service worker derives its prefix from `self.registration.scope`**, and
  is registered at `${import.meta.env.BASE_URL}sw.js` with that scope. A
  hardcoded `/sw.js` at scope `/` is out of scope under a prefixed deploy, so
  every local-data fetch falls through to the network and 404s.

`sw.js` lives in `public/` and is copied rather than bundled, which makes it
exactly the kind of file a build drops silently — `pages.yml` asserts it is
there.

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

- **Applicability is reconstructed and unverified against real vehicles.** The
  grammar is specified, tested and validated by reachability, and the UI
  filters by version — but three things about it remain open and all are
  written down in
  [`docs/data-format.md` §5](docs/data-format.md#what-is-still-open): `?`, the
  precedence of `!` against an implicit AND, and how several matching
  alternatives on one callout are resolved. The browser also closes the world
  per criteria type, which is an inference that raises the unreachable count
  from 18 to 209; it says so on screen.
- **`SP.TR` is read but unused.** Its 120,134,472 rows key
  `MODELLO+TELAIO+MATRICOLA` to a `PART` — per-vehicle fitment — and how that
  relates to `TBDATA` is not worked out.
- **The F3 secondary indexes are unexamined.** `SP.CH` and `SP.RT` each carry
  one on `VIN`; nothing needs them, because a VIN reaches the primary index
  through its type code and chassis number.
- **`HOTSPOTS` is null on every row inspected**, so callouts are not clickable.
  openPER has the same gap.
- **`apps/cli` has no tests.** 60 elsewhere — 36 on the `PATTERN` grammar, 16
  on F3, 8 on the drawing shards, all against synthetic fixtures — but the SQL
  and the import are checked by running `eperx browse`, `eperx part` and
  `eperx import` against a real tree, and that is manual.
- **No browser tests in CI.** The UI is driven with Playwright by hand during
  development; nothing runs it on a push. The folder picker cannot be
  automated at all (see below).
- **Not in the UI:** cliches (`CLICHE` / `CPXDATA`), the graphical group
  selector (`MAP_*`), supersessions (the `replacements` query exists but
  nothing renders it), and the accessories catalogue.
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
