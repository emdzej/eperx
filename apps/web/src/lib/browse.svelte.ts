import {
  callouts,
  catalogues,
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
  type Subgroup,
  type Usage,
} from "@eperx/catalogue";
import { HttpSource } from "./http-source";
import { tree } from "./tree.svelte";

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

  search: "" as string,
  parts: [] as Part[],
  usages: [] as Usage[],
  part: undefined as Part | undefined,

  busy: false,
  error: undefined as string | undefined,
});

async function run(work: () => Promise<void>): Promise<void> {
  browse.busy = true;
  browse.error = undefined;
  try {
    await work();
  } catch (error) {
    browse.error = error instanceof Error ? error.message : String(error);
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
    browse.groups = await groups(tree.catalogue!, entry.code);
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
    const first = browse.drawings[0];
    if (first) await showDrawing(first);
  });
}

export async function showDrawing(drawing: Drawing): Promise<void> {
  if (!tree.catalogue) return;
  await run(async () => {
    browse.drawing = drawing;
    browse.callouts = await callouts(tree.catalogue!, drawing);
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

  const source = new HttpSource(`${tree.base}/images/${location.shard}.res`);
  const bytes = await source.read(location.offset, location.length);
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
