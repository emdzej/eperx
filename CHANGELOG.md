# Changelog

Notable changes, newest first. Claims about the disc's formats are listed with
the number that backs them, because a claim about someone else's data is only
worth as much as its evidence — the reasoning behind each one is in
[`docs/data-format.md`](docs/data-format.md).

Versions follow [semantic versioning](https://semver.org/). Before 1.0 a minor
bump is where features land.

## 0.2.0

### Reading bytes is csfs's job now

eperx had grown its own storage layer: a `ByteSource`, an `HttpSource` over
`fetch`, a `FileSource` over `node:fs`, and a `SourceFs`/`TargetFs` pair inside
the importer. All of it is now [csfs](https://github.com/emdzej/csfs), which is
that layer generalised into a library. The translation was almost nothing, which
is the argument for it: csfs models a file on `Blob`, so `read(pos, len)` is
`slice(pos, pos + len).bytes()`.

One thing got cheaper without being asked to. `HttpSource` did a `HEAD` per file
to learn its size; csfs takes sizes from the tree's manifest, so every shard and
chassis file costs one request fewer.

A served tree therefore carries `csfs-manifest.json`, because a static host
cannot list a directory. It is small only because the shards stay packed: **267
entries and 9 kB describing 6.52 GB**, against the 14.72 MB an extracted tree
would need.

### Import a disc without the CLI

Settings → Data → Import a disc reads a mounted disc in the browser, converts
the catalogue and writes the tree into browser storage. Same importer as the
CLI, same output.

Two measurements decided whether this was reasonable, and both were taken before
it was built. `mdb-reader` parses `SP.DB` as a **view** over the buffer rather
than a copy, so a 1,270 MiB database peaks at **1,200 MiB** — a cost equal to the
file, not a multiple of it. And SQLite compiled to WebAssembly, writing through
the SAH-pool VFS, sustains **141,995 inserts per second**, so five million rows
take about 37 s against the CLI's 43 s. Importing in the browser is not the slow
option.

The pool is not a preference: the ordinary `opfs` VFS needs `SharedArrayBuffer`,
hence COOP/COEP headers on the origin, and requiring those of whoever hosts a
tree would undo the point of it being servable from anywhere.

### Three bands, and the parts in their own column

The interface follows [masax](https://masax.emdzej.pl): the car on top, the tree
on the left, the answer on the right.

The parts list moving into its own column is the substantial part. A callout list
is read _against_ the diagram — you find a reference on the image and want to
know what it is — so the two belong side by side rather than stacked with the
table clipped. It also gained two things about honesty: the header says how many
rows exist and how many are shown, and when rows are hidden the footer says so
in a sentence. A filtered table that looks complete is the one place this
interface could talk someone into ordering the wrong part.

The VIN came out from behind its popover and sits inline with a button, because
it is the _better_ of the two routes when it is available: it reaches that
individual car's build record rather than its model variant's. A spec strip shows
what eperx actually knows — a version offers its `SINCOM`, engine type and doors;
a VIN reaches `SP.CH` and offers that car's own chassis number, engine number,
build date and interior colour. There is no report to print, because a build
record is not a spec sheet.

A drawing's variants are tabs above it rather than a column beside it, which gave
the diagram back twelve rems — measured, 605 to 1100 pixels at 1440. They carry
the variant as well as the name, because the name alone does not distinguish
them and that is the common case: a subgroup's five rows are routinely all called
`SEMI-COMPLETE ENGINE`. At actual size the drawing can be dragged, because a
scrollbar is not how anyone moves around a drawing.

### A parts bin, notes, and copying

Every callout row offers add-to-bin, write-a-note, copy-the-number and
copy-the-description; the drawing offers copy and a zoom.

The bin is keyed by **part number**, not by callout reference. The same number
appears under different references on different drawings, so adding it twice
means two of them rather than two lines that happen to match. It records
catalogue, group, drawing and the vehicle at the moment of adding, because a pick
list is acted on away from the screen. CSV out, quoting every field
unconditionally — a description is `SCREWS, STUD BOLTS, NUTS, ETC.`, so commas
are the norm rather than the exception.

Notes are keyed by part number too, and deliberately not scoped to a catalogue: a
bolt is the same bolt on every drawing it appears on.

### English and Polish

eperx speaks its own language now, chosen separately from the catalogue's — the
disc carries text in twenty languages and the toolbar already picks between
whichever were imported. They are independent, and a Polish-speaking desk reading
an English-only tree is the normal case.

i18next rather than a hand-rolled lookup for one reason: **Polish plurals**. This
interface counts things, and Polish needs one/few/many where English needs
one/other. Four structural tests guard it, because every failure here is silent.

### Installable, and it opens with no network

eperx is a progressive web app: a manifest, icons, and a service worker that
precaches the shell — **23 entries, 5.9 MB**, both WebAssembly modules included,
so a tree in browser storage is fully usable offline.

**The worker does two jobs and the order matters.** It already existed to serve a
picked folder to SQLite over `Range`, and there is one worker per scope. So
`/__eperx/` is handled first and answers its own `206`, then ranged requests bail
outright, and only then is a whitelist of precached URLs consulted. A cached `200`
answering a `Range` request would return the wrong bytes at every offset while
SQLite decoded plausible garbage — which is why the worker stays hand-written
rather than generated.

### Everything you typed, in one file

Settings → Interface exports the bin, the notes, the language, the theme and
where you were. The reason notes are worth backing up applies to all of it: none
of it can be re-derived from a disc, and everything else in eperx can. Notes
merge newest-first on import, so a colleague's file adds to yours; the bin is
replaced, because merging two pick lists would silently double quantities.

`?data=<url>` opens a hosted tree and remembers it, so a link handed to a
colleague sets their source up rather than working once.

### Fixed

- **A subgroup could open a drawing the vehicle cannot have.** Selecting one
  showed `drawings[0]` rather than the first the filter would show, so subgroup
  6 of a 1.2 petrol opened `10106-010 v1` — a 1.3 JTD variant marked "does not
  fit" — with its diesel parts listed beneath and no tab selected, because the
  tabs correctly offered only the two fitting variants of eight. The rule now
  lives in one place and everything that picks a drawing uses it; the drawing
  on screen also always keeps its tab, so a where-used jump to an excluded
  variant is legible rather than silent.
- **A folder-mounted tree could report `SQLITE_CORRUPT`.** The worker held its
  mount in memory, and a service worker's memory does not last — the browser
  restarts it whenever it likes, and a new version claims the page on activation.
  Either way the map came back empty while the page believed it was mounted, so a
  page read got a `404` and SQLite read that as the page's contents. It recovers
  the folder from IndexedDB now, and the page re-posts on `controllerchange`.
- **A reload after a deploy served the previous app.** Navigations were answered
  from cache, and `index.html` is the one shell file with no content hash — so it
  named the old bundle, and only the second reload got the new one. Every fix
  appeared not to have worked. Navigations are network-first now, falling back to
  the cached index when offline.
- **The shell cache never rotated.** It was named for the package version, which
  had not changed since the first commit, so `activate` swept nothing. It is
  keyed to a hash of the build manifest now.
- **A `--link` tree failed on the first drawing.** Symlinks point out of the
  granted folder and a browser refuses to follow them, so such a tree mounts,
  browses, and then 404s every image. `import` warns, and the client says so on
  connecting.
- **The toolbar crushed itself** instead of wrapping, putting `CATALOGUE` on top
  of `VEHICLE`; the part-number box sat two pixels above its neighbours; the
  drawing's own controls panned away with the drawing; and the settings gear was
  a filled blob that read as a flower at 14 px.
- **The VIN box could stay disabled** against a tree that had chassis files: the
  check memoised its answer before a tree was open.

### Corrected

- VIN type code `312` reaches **four** models (`150`, `319`, `402`, `519`), not
  three. Averaged over the 73 distinct codes the fan-out is **3.3 catalogues**
  and 1.8 models, reaching as many as 15 catalogues and 7 models.
- `docs/data-format.md` claimed the F3 block index was unimplemented and there
  was no chassis lookup. Both have existed since 0.1.0.

## 0.1.0

Reading an ePER disc end to end, and browsing it in a browser with no backend.

All three storage formats cracked and validated against edition 83:
`SP.DB`/`AM.DB` as Access Jet 4, converted once to SQLite with indexes chosen for
the queries the client makes; `images/*.res` as ordinary ZIPs whose **219,253
entries across the 256 hex shards are stored rather than deflated**, so a browser
pulls a PNG out of a 19 MB archive with one `Range` request and 4.7 GB of
drawings pass through untouched; and `SP.CH`/`SP.RT` as F3, ePER's own blocked
store, binary-searched over ranged reads rather than downloaded.

The `PATTERN` grammar specified, implemented and validated by reachability: all
**107,957** distinct patterns parse bar 39 malformed ones, and across all 223
catalogues **18 of 81,415 drawings are unreachable — 0.02%**. Evaluation is
three-valued, so "not known" is an answer rather than a guess, and only a definite
non-fit is ever hidden.

A whole browsing session — connect, walk to a drawing, read its callouts, search
a part number, list its usages — costs **92 requests and 597 kB of a 568 MB
database**, plus 49 kB for the drawing.
