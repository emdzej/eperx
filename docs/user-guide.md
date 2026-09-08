# Using eperx

A parts catalogue for Fiat, Lancia, Alfa Romeo, Abarth, LCV and Chrysler, run
from an ePER disc you already have. It ships **without data**, so the first
thing to do is give it some — that is most of this guide.

> **Read this before trusting a parts list.** Which parts fit which vehicle is
> **reconstructed** from the disc and has never been checked against a real
> car. See [What it will not tell you](#what-it-will-not-tell-you).

**Contents**

- [What you need](#what-you-need)
- [Getting your data in](#getting-your-data-in) — three routes
- [The four data sources](#the-four-data-sources)
- [Finding a part](#finding-a-part)
- [Narrowing to one vehicle](#narrowing-to-one-vehicle)
- [Settings](#settings)
- [When something goes wrong](#when-something-goes-wrong)
- [What it will not tell you](#what-it-will-not-tell-you)

## What you need

An **ePER disc** — the DVD, or an ISO of it mounted as a drive. eperx is built
against **ePER 8.3, edition 83, data release 4147**; other releases may work,
because nothing hardcodes the release number, but they are untested.

A **browser**. Any current one will read a catalogue served over HTTP. The two
local routes — opening a folder, and importing a disc — use the File System
Access API, which today means **Chromium-based** browsers: Chrome, Edge,
Brave, Opera, Arc. Firefox and Safari can still use the HTTP route.

For importing in the browser, a **desktop**. The catalogue is read into memory
whole, which is 1.27 GB on edition 83.

## Getting your data in

Three routes to the same place. Pick by what you have.

| Route                                                             | Needs              | Good for                                   |
| ----------------------------------------------------------------- | ------------------ | ------------------------------------------ |
| [In the browser](#a-import-in-the-browser)                        | Chromium, desktop  | Getting going with no tooling at all       |
| [With the CLI, served](#b-import-with-the-cli-and-serve-it)       | Node 22+           | A tree several machines or people can read |
| [With the CLI, local](#c-import-with-the-cli-and-open-the-folder) | Node 22+, Chromium | One machine, nothing listening on a port   |

Either way the result is the same shape: a **tree** — a folder holding
`catalogue.sqlite`, the drawing shards, the chassis files, and two small
manifests describing it.

### A. Import in the browser

No CLI, nothing installed. Mount the disc, then:

1. Open eperx. On a first visit the data panel appears on its own; otherwise
   click the **gear** in the top bar.
2. Find **Import a disc** at the foot of the panel and click
   **Choose the disc folder…**
3. Pick the disc's **root** or its `data` folder — either works — and grant
   access when the browser asks.
4. eperx reads the disc and shows what is on it: the release, the components
   it found with their sizes, and the languages it carries.
5. Choose what to keep — see [Choosing languages](#choosing-languages) — then
   click **Import**.
6. When it finishes, click **Open it**.

The tree is written into the browser's own private storage, so it reopens on
later visits with no prompt and no disc mounted.

**How long.** A couple of minutes for the catalogue, longer for the drawings.
Leaving the tab is fine — the work runs in a worker — but **closing it
abandons the import**.

**If it will not fit,** the panel says so before starting, with how much room
the browser will give and how much short you are. Untick the drawings, or keep
fewer languages.

### B. Import with the CLI, and serve it

Needs a recent **Node** — it uses the built-in `node:sqlite`, which arrived
during the 22 line. Developed and tested on **26**; nothing in the repo
enforces a minimum, so an older Node fails at `import` rather than at install.

```sh
pnpm install
pnpm build

cli=apps/cli/dist/index.js

# What is on the disc, and which release
node $cli disc /Volumes/ePER\ ed.83

# English only: 568 MB of catalogue, plus the shards copied
node $cli import /Volumes/ePER\ ed.83 -o data -l 3
```

Then serve it:

```sh
node $cli serve -d data                          # the tree, on :8998
node $cli serve -d apps/web/dist -p 8080 --spa   # the client, on :8080
```

Open the client, choose **Over HTTP**, enter the tree's URL — for the above,
`http://127.0.0.1:8998` — and click **Open**.

This also works from the **deployed** client at
[eperx.emdzej.pl](https://eperx.emdzej.pl) against a tree on your own machine:
loopback is a trustworthy origin, so it is not mixed content, and `serve`
sends the header Chrome wants before a public page may reach a private
address.

Any static host will do, not just `eperx serve` — it only has to honour
`Range`. A host that ignores it is **rejected** rather than trusted, because
its answer to "give me these 4 kB" is the whole 568 MB file, and using that as
a slice returns the wrong bytes silently.

### C. Import with the CLI, and open the folder

Import as above, then in eperx choose **A folder on this machine** →
**Choose folder…** and pick the tree. Nothing is copied and nothing listens on
a port.

> **Do not use `--link` for this route.** It saves 5.7 GB by symlinking the
> shards and chassis files instead of copying them, and a browser will not
> follow a symlink out of the folder you granted — that is a sandbox escape,
> and it blocks it. Such a tree mounts, browses, and then fails on the first
> drawing. `import` warns when it makes one, and eperx says so on connecting.
> A linked tree is fine over HTTP, where the server resolves the links.

### Choosing languages

This is the main size lever: the per-language description tables are about
**62% of all rows**. One language gives 5,253,068 rows in 568 MB; all twenty
is roughly two and a half times that.

Edition 83 carries these `LNG_COD` values:

| Code | Language | Code | Language   | Code | Language  | Code | Language |
| ---- | -------- | ---- | ---------- | ---- | --------- | ---- | -------- |
| `0`  | Italian  | `5`  | Portuguese | `D`  | Greek     | `R`  | Romanian |
| `1`  | French   | `6`  | Polish     | `H`  | Hungarian | `S`  | Serbian  |
| `2`  | Spanish  | `7`  | Dutch      | `J`  | Japanese  | `T`  | Turkish  |
| `3`  | English  | `9`  | Danish     | `K`  | Chinese   | `V`  | Swedish  |
| `4`  | German   | `B`  | Czech      | `L`  | Slovak    | `N`  | Russian  |

The browser wizard lists them with names read from the disc and ticks your
browser's language, or English. The CLI takes codes:

```sh
node $cli import /Volumes/ePER\ ed.83 -o data -l 3      # English
node $cli import /Volumes/ePER\ ed.83 -o data -l 0,3,4  # Italian, English, German
```

Keeping several is not wasteful in use — eperx switches between whatever the
tree holds with the dropdown in the top bar, without re-importing.

### Trimming an import

```sh
--no-images        # skip the drawings: 4.7 GB, and no diagrams afterwards
--no-chassis       # skip the F3 files: 706 MB, and no VIN lookup
--no-accessories   # skip the Mopar catalogue
-f, --force        # replace a tree that is already there
```

## The four data sources

The **gear** in the top bar opens Settings; its **Data** tab holds all four.
Your choice is remembered.

| Source                       | Stores anything?      | Works in          | Notes                                                     |
| ---------------------------- | --------------------- | ----------------- | --------------------------------------------------------- |
| **Over HTTP**                | No                    | Any browser       | Needs the tree's `csfs-manifest.json` and `Range` support |
| **A folder on this machine** | No — read in place    | Chromium          | One click after a reload; no symlinked trees              |
| **Stored in this browser**   | Yes, a full copy      | Chromium          | Opens with no prompt and no disc mounted                  |
| **Import a disc**            | Yes, builds the above | Chromium, desktop | The only route needing no CLI                             |

HTTP and browser storage reopen silently. A saved **folder** needs one click,
because browsers drop a directory's permission across a reload and can only
ask for it back inside a click. eperx shows the folder it remembers and a
button to grant it again.

**Forget** clears a remembered folder — and the vehicle you were looking at
with it, since that selection means nothing against a different tree.
**Discard** empties the browser's copy.

## Finding a part

Two ways in.

**By walking the catalogue.** Across the top: **Make**, **Model**,
**Catalogue**, and the vehicle. Each is searchable — type to filter, since a
marque can carry 104 catalogues and a catalogue up to 10,436 versions. Down
the left: **Group** and **Subgroup**, as lists rather than dropdowns because
they are short and they are what you move around in. The drawing and its
numbered callout list fill the rest.

**By part number.** The search box in the top bar. It matches on a prefix, so
`55189` finds `55189942`, and gives what the part is, every drawing it appears
on, and what superseded it in both directions.

Clicking a search result selects that part; clicking a row in its where-used
list jumps to that drawing. Above the diagram is a **variant strip** — one
entry per `DRAWINGS` row for the subgroup, each a different applicability —
and clicking one switches to it.

**The callouts themselves are not clickable**, and neither is the diagram. The
coordinates that would make them so are null on every row of this release; see
[What it will not tell you](#what-it-will-not-tell-you).

## Narrowing to one vehicle

Applicability is the point of a parts catalogue: most drawings in a subgroup do
not apply to the car in front of you. Choose a vehicle and eperx scores
everything on screen.

**By version.** The **Vehicle** dropdown lists every version the catalogue
sold, searchable by description or `SINCOM`.

**By VIN.** The **VIN** button beside it. A Fiat-group VIN carries the model
type code and the chassis number, which is how the disc's own index is keyed,
so nothing VIN-specific is needed. This is **better than a version when you
have it**: the disc holds that individual car's build record, so the criteria
are the car's own rather than its model variant's.

Verdicts are marked, and the glyphs matter:

|       | Meaning                                    |
| ----- | ------------------------------------------ |
| **✓** | fits                                       |
| **✗** | does not fit                               |
| **?** | **not determined** — the data does not say |

Tick **filter** to hide the definite non-fits. A 1.3 JTD Panda narrows a
subgroup from 13 drawings to 3. **Only a definite ✗ is ever hidden** — a `?` is
always shown, because declining to answer must not look like an answer.

Your make, model, catalogue and vehicle are remembered, so a reload puts you
back where you were.

## Settings

The **gear** opens Settings. The **Data** tab is above. Elsewhere in the top
bar: the **eperx** wordmark opens About, the version beside it links to that
release's notes, and there is a light/dark toggle. The language dropdown
appears when the tree holds more than one.

The footer shows where the catalogue is being read from and how many SQL
statements a click cost — visible on purpose, because the whole design rests on
reading pages rather than downloading files.

## When something goes wrong

**"No manifest.json with a catalogue at …"** — that folder or URL is not an
imported tree. Point it at what `eperx import -o` produced, not at the disc.

**Drawings 404, or the VIN lookup fails, but browsing works.** The tree was
built with `--link`. See [route C](#c-import-with-the-cli-and-open-the-folder).
Serve it over HTTP, or re-import without `--link`.

**Nothing loads over HTTP, and the tree looks fine.** Two causes. The tree may
have no `csfs-manifest.json` — trees built before eperx moved to csfs do not.
Re-run `eperx import` to get one, or build one in place with
`npx @emdzej/csfs-cli manifest <tree>`. The other cause is a host that ignores
`Range`, which eperx refuses rather than trusts.

**A VIN reports "Not on this disc", listing how far each model reaches.** The
disc is a snapshot from 2014. If the highest chassis for the model is below
yours, the car was built after the disc was pressed and is simply not in it —
and eperx says so rather than pretending it looked wrong. Note the comparison
is only meaningful **within a chassis series**: the numeric, `J` and `O` runs
do not order as one space.

**"This browser cannot open a folder."** Not Chromium. Use the HTTP route.

**The import runs out of room.** The panel says how much short before it
starts. Drop the drawings, or keep fewer languages.

**Two console warnings on every load.** Both expected, and one is a decision
being reported back:

- `Ignoring inability to install OPFS sqlite3_vfs … COOP/COEP` — SQLite probing
  for a storage backend it does not need here. eperx sends no such headers on
  purpose, so a tree stays servable from any host. The word _Ignoring_ is the
  library saying it coped.
- `Page size … is 4096, recommended size is 1024` — advice we measured against
  and declined. Over a link with real latency, fewer large reads beat four
  times as many small ones.

## What it will not tell you

Stated plainly, because a parts catalogue that overstates itself is worse than
none.

- **Applicability is reconstructed and unverified against real vehicles.** The
  grammar is specified, tested, and validated against the data's own
  consistency — across all 223 catalogues, 18 of 81,415 drawings are
  unreachable by any version, 0.02%. That is a check for self-consistency, not
  a check against a car. Three details of the grammar remain open, listed in
  [`data-format.md` §5](data-format.md#what-is-still-open).
- **No prices.** `SP.PL` is on the disc and out of scope by decision.
- **Callouts are not clickable.** `HOTSPOTS`, which should carry the image-map
  coordinates, is null on every row inspected — openPER reports the same gap.
  The callout list is read beside the diagram, not on it.
- **No ordering, no dealer systems, no licensing.**
- **The data is Fiat's.** eperx ships none of it, redistributes none of it, and
  is not derived from it.

Fuller detail: [`data-format.md` §8](data-format.md#8-what-is-not-decoded) for
what is undecoded, and [`plan.md`](plan.md) for why the project is shaped as it
is.
