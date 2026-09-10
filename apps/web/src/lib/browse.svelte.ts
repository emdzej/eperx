import {
  callouts,
  catalogues,
  closeSpecification,
  criteriaIn,
  criteriaMeanings,
  criteriaVocabulary,
  evaluatePattern,
  parsePattern,
  resolvePattern,
  specificationOf,
  Truth,
  versions,
  drawings,
  groups,
  imageLocation,
  makes,
  modelGroups,
  searchParts,
  subgroups,
  whereUsed,
  type Callout,
  type CatalogueEntry,
  type Drawing,
  type Group,
  type Make,
  type ModelGroup,
  type Part,
  type CriterionMeaning,
  type Specification,
  type Subgroup,
  type Usage,
  type Version,
} from "@eperx/catalogue";
import { required } from "./filesystem";
import { clearSelection, readSelection, writeSelection, type SavedVehicle } from "./selection";
import { tree } from "./tree.svelte";
import { lookupVin, vin, vinSpecification, vinSummary } from "./vin.svelte";

/**
 * Where the user is in the catalogue, and what that implies is on screen.
 *
 * One flat object rather than nested state: selecting a level clears
 * everything below it, and doing that in one place is how the drawing on
 * screen is kept from outliving the catalogue it belongs to.
 */
export const browse = $state({
  makes: [] as Make[],
  modelGroups: [] as ModelGroup[],
  catalogues: [] as CatalogueEntry[],
  groups: [] as Group[],
  subgroups: [] as Subgroup[],
  drawings: [] as Drawing[],
  callouts: [] as Callout[],

  make: undefined as Make | undefined,
  modelGroup: undefined as ModelGroup | undefined,
  catalogue: undefined as CatalogueEntry | undefined,
  group: undefined as Group | undefined,
  subgroup: undefined as Subgroup | undefined,
  drawing: undefined as Drawing | undefined,

  imageUrl: undefined as string | undefined,
  /** Bytes of the PNG itself, kept apart from the database's page traffic. */
  imageBytes: 0,

  // The chosen vehicle version, and what it implies.
  versions: [] as Version[],
  versionSearch: "" as string,
  version: undefined as Version | undefined,
  /** Truth per drawing, keyed as table/variant/revision. */
  fit: new Map<string, string>(),
  /** Truth per callout, keyed as reference/sequence/part. */
  calloutFit: new Map<string, string>(),
  /** Hide what definitely does not fit the chosen vehicle. */
  hideUnfit: true,
  /** Where the current specification came from. */
  source: undefined as "version" | "vin" | undefined,

  search: "" as string,
  parts: [] as Part[],
  usages: [] as Usage[],
  part: undefined as Part | undefined,

  busy: false,
  error: undefined as string | undefined,
});

/**
 * Suppresses `remember()` while a restore walks down the levels.
 *
 * Without it, restoring the marque would immediately save a selection with no
 * model or catalogue in it, and the rest of what we were restoring would be
 * gone before we got to it.
 */
let restoring = false;

/**
 * Would the filter hide this verdict?
 *
 * The one rule, in one place, because three components ask it and a drawing
 * chosen by a different rule than the one that lists them is how a drawing
 * came to be shown with no tab selected — see {@link firstVisible}.
 *
 * Only a **definite** non-fit is hidden. "Not determined" is always shown:
 * declining to answer must not look like an answer, and hiding on uncertainty
 * would quietly lose real parts.
 */
export function hiddenByFilter(verdict: string | undefined): boolean {
  return browse.source !== undefined && browse.hideUnfit && verdict === "false";
}

/**
 * The drawing to open when a subgroup is chosen.
 *
 * The first one the filter would *show*, not the first in the list. Those are
 * different things and the difference was a real fault: subgroup 6 of a 1.2
 * petrol opened `10106-010 v1`, a 1.3 JTD variant marked "does not fit", with
 * its diesel parts listed beneath and no tab selected — because the tabs
 * correctly offered only the two fitting variants of eight.
 *
 * Falls back to the first of all when every one is excluded, so a subgroup
 * still shows something and the footer's verdict says what it is. Showing
 * nothing would read as missing data rather than as a vehicle that has none of
 * these parts.
 */
export function firstVisible(list: Drawing[]): Drawing | undefined {
  return list.find((d) => !hiddenByFilter(browse.fit.get(drawingKey(d)))) ?? list[0];
}

/** Hide or show definite non-fits, and remember which. */
export function setHideUnfit(value: boolean): void {
  browse.hideUnfit = value;
  remember();
}

/** Keep the four choices above the group tree, so a reload lands back here. */
function remember(): void {
  if (restoring) return;
  writeSelection({
    make: browse.make?.code,
    modelGroup: browse.modelGroup?.code,
    catalogue: browse.catalogue?.code,
    vehicle: savedVehicle(),
    hideUnfit: browse.hideUnfit,
  });
}

function savedVehicle(): SavedVehicle | undefined {
  if (browse.source === "vin" && vin.query) return { kind: "vin", vin: vin.query };
  const version = browse.version;
  if (browse.source === "version" && version) {
    return {
      kind: "version",
      sincom: version.sincom ?? undefined,
      model: version.model,
      version: version.version,
      series: version.series,
    };
  }
  return undefined;
}

/**
 * Something thrown, as a sentence.
 *
 * `String(error)` gives `[object Object]` for anything that is not an `Error`,
 * and that is exactly what reached the footer when SQLite failed: the WASM
 * binding rejects with a plain object carrying `result.message`, so the user
 * was told `[object Object]` about a corrupt database. Every shape that has
 * turned up is tried before falling back.
 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const bag = error as {
      message?: unknown;
      result?: { message?: unknown };
      toString?: () => string;
    };
    if (typeof bag.message === "string" && bag.message) return bag.message;
    if (typeof bag.result?.message === "string" && bag.result.message) return bag.result.message;
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      // Circular. Fall through to the last resort.
    }
  }
  return String(error);
}

async function run(work: () => Promise<void>): Promise<void> {
  browse.busy = true;
  browse.error = undefined;
  try {
    await work();
  } catch (error) {
    browse.error = describe(error);
  } finally {
    browse.busy = false;
  }
}

export async function loadMakes(): Promise<void> {
  if (!tree.catalogue) return;
  await run(async () => {
    browse.makes = await makes(tree.catalogue!);
  });
}

export async function selectMake(make: Make): Promise<void> {
  if (!tree.catalogue) return;
  await run(async () => {
    Object.assign(browse, {
      make,
      modelGroup: undefined,
      catalogue: undefined,
      group: undefined,
      subgroup: undefined,
      catalogues: [],
      groups: [],
      subgroups: [],
      drawings: [],
      callouts: [],
    });
    clearDrawing();
    browse.modelGroups = await modelGroups(tree.catalogue!, make.code);
    remember();
  });
}

export async function selectModelGroup(modelGroup: ModelGroup): Promise<void> {
  if (!tree.catalogue || !browse.make) return;
  await run(async () => {
    Object.assign(browse, {
      modelGroup,
      catalogue: undefined,
      group: undefined,
      subgroup: undefined,
      groups: [],
      subgroups: [],
      drawings: [],
      callouts: [],
    });
    clearDrawing();
    browse.catalogues = await catalogues(tree.catalogue!, browse.make!.code, modelGroup.code);
    remember();
  });
}

export async function selectCatalogue(entry: CatalogueEntry): Promise<void> {
  if (!tree.catalogue) return;
  await run(async () => {
    Object.assign(browse, {
      catalogue: entry,
      group: undefined,
      subgroup: undefined,
      subgroups: [],
      drawings: [],
      callouts: [],
    });
    clearDrawing();
    browse.version = undefined;
    browse.source = undefined;
    browse.versions = [];
    browse.versionSearch = "";
    browse.fit = new Map();
    browse.calloutFit = new Map();
    await loadCriteria(entry.code);
    await selectVersion(undefined);
    const [loaded] = await Promise.all([groups(tree.catalogue!, entry.code), searchVersions("")]);
    browse.groups = loaded;
    remember();
  });
}

export async function selectGroup(group: Group): Promise<void> {
  if (!tree.catalogue || !browse.catalogue) return;
  await run(async () => {
    Object.assign(browse, { group, subgroup: undefined, drawings: [], callouts: [] });
    clearDrawing();
    browse.subgroups = await subgroups(tree.catalogue!, browse.catalogue!.code, group.code);
  });
}

export async function selectSubgroup(subgroup: Subgroup): Promise<void> {
  if (!tree.catalogue || !browse.catalogue || !browse.group) return;
  await run(async () => {
    Object.assign(browse, { subgroup, callouts: [] });
    clearDrawing();
    browse.drawings = await drawings(
      tree.catalogue!,
      browse.catalogue!.code,
      browse.group!.code,
      subgroup.code,
    );
    scoreDrawings();
    const first = firstVisible(browse.drawings);
    if (first) await showDrawing(first);
  });
}

export async function showDrawing(drawing: Drawing): Promise<void> {
  if (!tree.catalogue) return;
  await run(async () => {
    browse.drawing = drawing;
    browse.callouts = await callouts(tree.catalogue!, drawing);
    scoreCallouts();
    await loadImage(drawing);
  });
}

/**
 * Fetch the drawing.
 *
 * Two steps and no more: the `images` table gives the byte range, then one
 * `Range` request against the vendor's own `.res` archive returns the PNG.
 * The entry is stored rather than deflated, so those bytes go straight into a
 * blob with nothing in between.
 */
async function loadImage(drawing: Drawing): Promise<void> {
  clearDrawing();
  if (!drawing.image || !tree.catalogue) return;

  const slash = drawing.image.indexOf("/");
  const entry = slash === -1 ? drawing.image : drawing.image.slice(slash + 1);
  const location = await imageLocation(tree.catalogue, entry);
  if (!location) {
    browse.error = `${entry} is not in the image index — was the tree imported with drawings?`;
    return;
  }

  if (!tree.fs) throw new Error("the tree is not open");
  const shard = await required(tree.fs, `images/${location.shard}.res`);
  // The byte range came from the `images` index built at import time, so this
  // is one read and no central directory: see the note in `packages/res`.
  const bytes = await shard.slice(location.offset, location.offset + location.length).bytes();
  if (bytes.length !== location.length) {
    throw new Error(`short read: wanted ${location.length} bytes, got ${bytes.length}`);
  }
  const payload =
    location.method === 0
      ? bytes
      : new Uint8Array(
          await new Response(
            new Blob([bytes as BlobPart])
              .stream()
              .pipeThrough(new DecompressionStream("deflate-raw")),
          ).arrayBuffer(),
        );

  browse.imageBytes = bytes.length;
  browse.imageUrl = URL.createObjectURL(new Blob([payload as BlobPart], { type: "image/png" }));
}

function clearDrawing(): void {
  if (browse.imageUrl) URL.revokeObjectURL(browse.imageUrl);
  browse.imageUrl = undefined;
  browse.imageBytes = 0;
}

export async function runSearch(query: string): Promise<void> {
  if (!tree.catalogue || !query.trim()) return;
  await run(async () => {
    browse.parts = await searchParts(tree.catalogue!, query.trim());
    browse.part = undefined;
    browse.usages = [];
  });
}

export async function selectPart(part: Part): Promise<void> {
  if (!tree.catalogue) return;
  await run(async () => {
    browse.part = part;
    browse.usages = await whereUsed(tree.catalogue!, part.code);
  });
}

/** Jump from a where-used row straight to that drawing. */
export async function openUsage(usage: Usage): Promise<void> {
  if (!tree.catalogue) return;
  await run(async () => {
    const found = await drawings(tree.catalogue!, usage.catalogue, usage.group, usage.subgroup);
    const match =
      found.find((d) => d.table === usage.table && d.variant === usage.variant) ?? found[0];
    if (!match) return;
    browse.drawings = found;
    browse.parts = [];
    browse.usages = [];
    browse.part = undefined;
    await showDrawing(match);
  });
}

/** Key a drawing for the fit map. */
export function drawingKey(drawing: Drawing): string {
  return `${drawing.table}/${drawing.variant}/${drawing.revision}`;
}

/** Key a callout for the fit map. */
export function calloutKey(item: Callout): string {
  return `${item.reference}/${item.sequence}/${item.part}`;
}

/**
 * Tokenisation vocabulary and criteria descriptions for the open catalogue.
 *
 * Held outside the rune state: they are per-catalogue lookup tables of a few
 * thousand entries, and making them reactive would mean Svelte proxying every
 * Map access on a hot path.
 */
let vocabulary: Set<string> = new Set();
let meanings: Map<string, CriterionMeaning> = new Map();
let specification: Specification | undefined;

/** What a pattern says, in words, for display beside the expression. */
export function explainPattern(pattern: string | null): string {
  if (!pattern) return "";
  try {
    const resolved = resolvePattern(parsePattern(pattern), vocabulary);
    const parts = criteriaIn(resolved).map((criterion) => {
      const meaning = meanings.get(criterion.token);
      if (!meaning) return criterion.token;
      return [meaning.typeName, meaning.codeName].filter(Boolean).join(" ") || criterion.token;
    });
    return [...new Set(parts)].join(" · ");
  } catch {
    // A malformed pattern is shown as-is rather than explained. 39 of the
    // corpus's 107,957 are malformed and repairing them is not this code's job.
    return "";
  }
}

async function loadCriteria(catalogue: string): Promise<void> {
  if (!tree.catalogue) return;
  [vocabulary, meanings] = await Promise.all([
    criteriaVocabulary(tree.catalogue, catalogue),
    criteriaMeanings(tree.catalogue, catalogue),
  ]);
}

/**
 * Adopt the vehicle a VIN lookup found.
 *
 * Preferred over a version when available: `CARATT` describes that individual
 * car, so this is the specification of a vehicle rather than of a model
 * variant.
 */
export async function applyVin(): Promise<void> {
  await run(async () => {
    const found = vinSpecification(vocabulary);
    if (!found) {
      browse.error = "That vehicle has no build record on this disc, so its options are unknown.";
      return;
    }
    specification = found;
    browse.source = "vin";
    browse.version = undefined;
    scoreDrawings();
    scoreCallouts();
    if (browse.drawing && browse.fit.get(drawingKey(browse.drawing)) === Truth.False) {
      const replacement = firstVisible(browse.drawings);
      if (replacement && replacement !== browse.drawing) await showDrawing(replacement);
    }
    remember();
  });
}

/** What the current filter is based on, for the UI to state plainly. */
export function specificationLabel(): string | undefined {
  if (browse.source === "vin") return vinSummary() ?? vin.query;
  if (browse.source === "version") return browse.version?.description ?? undefined;
  return undefined;
}

export async function searchVersions(query: string): Promise<void> {
  if (!tree.catalogue || !browse.catalogue) return;
  await run(async () => {
    browse.versionSearch = query;
    browse.versions = await versions(tree.catalogue!, browse.catalogue!.code, {
      search: query,
      limit: 200,
    });
  });
}

/**
 * Choose a vehicle version, and score everything on screen against it.
 *
 * The specification is closed per criteria type — see `closeSpecification`.
 * Without that, a drawing for the 1.2 petrol evaluates to "unknown" rather
 * than "does not fit" against a 1.3 diesel, and nothing useful can be hidden.
 */
export async function selectVersion(version: Version | undefined): Promise<void> {
  await run(async () => {
    browse.version = version;
    browse.source = version ? "version" : undefined;
    specification = version && specificationOf(version);
    if (specification) specification = closeSpecification(specification, vocabulary);
    scoreDrawings();
    scoreCallouts();

    // The drawing on screen may be one this version cannot have. Leaving it
    // there shows a diagram flagged "does not fit" beside a variant list that
    // no longer offers it, which reads as a bug and is one.
    if (browse.drawing && browse.fit.get(drawingKey(browse.drawing)) === Truth.False) {
      const replacement = firstVisible(browse.drawings);
      if (replacement && replacement !== browse.drawing) await showDrawing(replacement);
    }
    remember();
  });
}

function score(pattern: string | null): string {
  if (!specification) return Truth.Unknown;
  if (!pattern) return Truth.True; // no pattern constrains nothing
  try {
    return evaluatePattern(parsePattern(pattern), specification);
  } catch {
    return Truth.Unknown;
  }
}

function scoreDrawings(): void {
  const fit = new Map<string, string>();
  for (const drawing of browse.drawings) fit.set(drawingKey(drawing), score(drawing.pattern));
  browse.fit = fit;
}

function scoreCallouts(): void {
  const fit = new Map<string, string>();
  for (const item of browse.callouts) fit.set(calloutKey(item), score(item.formula));
  browse.calloutFit = fit;
}

export { scoreCallouts, scoreDrawings };

/**
 * Walk back to where the user was, if the tree still has it.
 *
 * Called once after `loadMakes()`. Each level is looked up in data that was
 * just loaded rather than trusted from storage, so a re-imported tree or a
 * different release cannot produce a selection that does not exist — a code
 * that no longer resolves just stops the walk, leaving the levels above it
 * selected and the rest for the user.
 *
 * The whole walk is guarded by `restoring`, because every `select*` saves as
 * it goes and would otherwise overwrite the very thing being read.
 */
export async function restoreSelection(): Promise<void> {
  const saved = readSelection();
  if (!saved || !tree.catalogue) return;

  restoring = true;
  try {
    if (saved.hideUnfit !== undefined) browse.hideUnfit = saved.hideUnfit;

    const make = browse.makes.find((m) => m.code === saved.make);
    if (!make) return;
    await selectMake(make);

    const modelGroup = browse.modelGroups.find((m) => m.code === saved.modelGroup);
    if (!modelGroup) return;
    await selectModelGroup(modelGroup);

    const catalogue = browse.catalogues.find((c) => c.code === saved.catalogue);
    if (!catalogue) return;
    await selectCatalogue(catalogue);

    await restoreVehicle(saved.vehicle);
  } catch (error) {
    // A restore is a convenience: failing it must not stop the app opening,
    // and the error would be about a selection the user has not asked for yet.
    // Logged rather than swallowed, because a silent catch here hid a real
    // bug once already.
    console.warn("eperx: could not restore the previous selection", error);
  } finally {
    restoring = false;
    // Save what actually came back, so a partial restore does not keep
    // retrying the parts that no longer resolve.
    remember();
  }
}

async function restoreVehicle(vehicle: SavedVehicle | undefined): Promise<void> {
  if (!vehicle) return;

  if (vehicle.kind === "vin") {
    await lookupVin(vehicle.vin);
    // Only apply it if the disc actually knows the car. A VIN that no longer
    // resolves — a different release, say — leaves the catalogue unfiltered
    // rather than filtered by nothing.
    if (vin.buildRecord) await applyVin();
    return;
  }

  // `selectCatalogue` loads the first 200 versions, and a catalogue can carry
  // 10,436 — so the saved one is searched for rather than looked for among
  // those already in hand.
  const found = await findVersion(vehicle);
  if (found) await selectVersion(found);
}

async function findVersion(saved: {
  sincom?: string;
  model: string;
  version: string;
  series: string;
}): Promise<Version | undefined> {
  const matches = (v: Version) =>
    saved.sincom
      ? v.sincom === saved.sincom
      : v.model === saved.model && v.version === saved.version && v.series === saved.series;

  const already = browse.versions.find(matches);
  if (already) return already;

  // `SINCOM` is what the search matches on, so a version without one can only
  // be found by loading the catalogue's versions and looking.
  await searchVersions(saved.sincom ?? "");
  return browse.versions.find(matches);
}

/** Forget where the user was — used when the data source changes. */
export { clearSelection };
