/**
 * Shared vocabulary for the ePER formats.
 *
 * Reading bytes is not here. It used to be — a `ByteSource` with
 * `size()`/`read(pos, len)` — and that has been replaced by `CsFile` from
 * `@emdzej/csfs-core`, which is the same idea with a `Blob`'s spelling:
 * `size` is a property and `read(pos, len)` is `slice(pos, pos + len).bytes()`.
 * Keeping our own meant every backend needed an adapter, and a `File` from a
 * picked directory already satisfies csfs's shape without one.
 *
 * What remains here is what is genuinely about ePER: the catalogue hierarchy's
 * vocabulary and how an image path is spelled.
 */

/** The five brands ePER ships, keyed by `MAKES.MK_COD`. */
export type MakeCode = "F" | "L" | "R" | "T" | "C" | "E";

/**
 * The catalogue hierarchy, in ePER's own terms. `Make → Model → Catalogue →
 * Group → SubGroup → SubSubGroup → Table → Drawing → Part`, with cliches
 * hanging off individual parts.
 *
 * The Italian column prefixes in the database (`GRP`, `SGRP`, `SGS`, `DRW`,
 * `PRT`, `CAT`) are kept as-is: the data uses them as keys and renaming them
 * would add a layer to get wrong.
 */
export interface CatalogueRef {
  /** `CATALOGUES.CAT_COD` — two or three characters, e.g. `"13"`. */
  cat: string;
}

/** An image in the `data/images/*.res` shards, as `DRAWINGS.IMG_PATH` spells it. */
export interface ImageRef {
  /** Shard, the first two hex characters of the id, e.g. `"BA"`. */
  shard: string;
  /** Entry name inside the shard, e.g. `"BA061CCF4B1E35C4D1CD4DF5A6B37B1B.png"`. */
  entry: string;
}

/**
 * Split a `DRAWINGS.IMG_PATH` (`"BA/BA061CCF….png"`) into shard and entry.
 *
 * The shard is not derivable from the entry name alone in the general case —
 * it is whatever precedes the slash — so this reads the path rather than
 * recomputing it from the first two characters.
 */
export function parseImagePath(imgPath: string): ImageRef | undefined {
  const slash = imgPath.indexOf("/");
  if (slash <= 0 || slash === imgPath.length - 1) return undefined;
  return { shard: imgPath.slice(0, slash), entry: imgPath.slice(slash + 1) };
}
